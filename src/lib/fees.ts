/**
 * Fee statement engine (Module 6, Level 4) — the single source of truth for a
 * student's whole-record fee picture: every enrollment (one-time AND monthly),
 * every billable cycle, resolved to a pay state, with per-currency totals that
 * NEVER blend across PKR / INR / USD.
 *
 * This module reads only. It computes what a student owes/paid from the exact
 * same rows the billing engine already writes — it never creates, edits, or
 * deletes a payment, an enrollment, or (least of all) a class recording. The
 * macro→micro navigation ladder (institute → course → roster → statement) ends
 * here at the micro: one sister's complete statement.
 *
 * All money math is delegated to the existing SSOT so this can never disagree
 * with the reminder cron or the payment-block gate:
 *   • monthlyAmountForEnrollment — FA-aware fee resolver (per currency)
 *   • cyclesBetween / firstOfMonth / formatCycleMonth / formatCyclePeriod
 *   • NON_BILLABLE_METHODS — the same exempt-method set the block gate uses
 *
 * `buildFeeStatement` is pure (rows in, structure out) so it is trivially
 * testable across every scenario. `fetchFeeStatementForStudent` does the IO and
 * hands the pure builder normalized rows. Both the student's own view and the
 * staff view call the fetcher, so the two produce byte-identical figures.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnrollmentStatus, FeeType } from "@/lib/types/database";
import {
  cyclesBetween,
  firstOfMonth,
  formatCycleMonth,
  formatCyclePeriod,
  monthlyAmountForEnrollment,
} from "@/lib/monthly-payments";
import { NON_BILLABLE_METHODS } from "@/lib/payment-block";

/**
 * The state of a single billable thing (a one-time enrollment or one monthly
 * cycle). Only `pending` and `owed` are live obligations; `paid` is settled;
 * `rejected` needs a re-submission; `waived` / `no_fee` cost nothing.
 */
export type PayState =
  | "paid"
  | "pending"
  | "owed"
  | "rejected"
  | "waived"
  | "no_fee";

export interface FeeCycle {
  cycleKey: string;
  /** e.g. "June 2026" */
  label: string;
  /** e.g. "May 27 – Jun 26, 2026" */
  period: string;
  state: PayState;
  amount: number;
  currency: string;
  /** True for the cycle that contains `asOf` — highlighted in the ledger. */
  isCurrent: boolean;
}

export interface FeeEnrollmentOneTime {
  state: PayState;
  /** Full sticker fee in the student's currency, before any FA reduction. */
  fullAmount: number;
  /** Fee actually due after FA (equals fullAmount when no FA reduction). */
  effectiveAmount: number;
  /** What the student actually paid (0 until a receipt is approved). */
  paidAmount: number;
  hasFaReduction: boolean;
  receiptUrl: string | null;
}

export interface FeeEnrollmentMonthly {
  monthlyAmount: number;
  fullAmount: number;
  hasFaReduction: boolean;
  /**
   * Set only when the enrollment itself is not yet approved (pending / rejected)
   * — billing has not started, so there are no cycles. Null once approved.
   */
  enrollmentState: PayState | null;
  /** True while an FA request on this enrollment is awaiting a decision. */
  faPending: boolean;
  cycles: FeeCycle[];
  paidCount: number;
  pendingCount: number;
  owedCount: number;
}

export interface FeeEnrollment {
  enrollmentId: string;
  offeringId: string;
  title: string;
  feeType: FeeType;
  currency: string;
  enrolledAt: string;
  /** Present iff feeType === "one_time". */
  oneTime?: FeeEnrollmentOneTime;
  /** Present iff feeType === "monthly". */
  monthly?: FeeEnrollmentMonthly;
}

export interface CurrencyTotal {
  currency: string;
  paid: number;
  pending: number;
  owed: number;
}

export interface FeeStatementData {
  studentId: string;
  studentName: string;
  enrollments: FeeEnrollment[];
  /** One entry per currency the student has any activity in. Never blended. */
  totals: CurrencyTotal[];
  currencies: string[];
  /** ISO date the statement was computed as-of (drives which cycle is current). */
  asOf: string;
  /** False when the student has no enrollments at all — renders an empty state. */
  hasActivity: boolean;
}

/** Normalized enrollment row the pure builder consumes. */
export interface FeeEnrollmentInput {
  enrollmentId: string;
  offeringId: string;
  offeringTitle: string;
  feeType: FeeType;
  status: EnrollmentStatus;
  paymentMethod: string;
  paymentCurrency: string;
  paymentAmount: number;
  paymentReceiptUrl: string | null;
  createdAt: string;
  faRequested: boolean;
  faReviewedAt: string | null;
  faApprovedAmount: number | null;
  offeringPrice: number;
  offeringPriceInr: number | null;
  offeringPriceUsd: number | null;
}

/** One monthly_payments row, normalized. */
export interface FeeMonthlyPaymentInput {
  enrollmentId: string;
  cycleMonth: string;
  status: string;
  amount: number;
  currency: string;
}

export interface FeeStatementInput {
  studentId: string;
  studentName: string;
  enrollments: FeeEnrollmentInput[];
  monthlyPayments: FeeMonthlyPaymentInput[];
}

const CURRENCY_ORDER = ["PKR", "USD", "INR"];

/** Currency the student transacts this enrollment in, upper-cased. */
function currencyOf(paymentCurrency: string): string {
  return (paymentCurrency || "PKR").toUpperCase();
}

/**
 * Resolve the full (pre-FA) and effective (post-FA) fee for an enrollment via
 * the shared SSOT, so the numbers match the reminder cron and block gate
 * exactly. The offering shape monthlyAmountForEnrollment needs is reassembled
 * from the normalized row.
 */
function resolveAmounts(e: FeeEnrollmentInput): {
  full: number;
  effective: number;
  currency: string;
  hasFaReduction: boolean;
} {
  const offering = {
    price: e.offeringPrice,
    price_inr: e.offeringPriceInr,
    price_usd: e.offeringPriceUsd,
  };
  const currency = currencyOf(e.paymentCurrency);
  const effective = monthlyAmountForEnrollment(offering, {
    payment_currency: currency,
    fa_approved_amount: e.faApprovedAmount,
  }).amount;
  const full = monthlyAmountForEnrollment(offering, {
    payment_currency: currency,
    fa_approved_amount: null,
  }).amount;
  const hasFaReduction = e.faApprovedAmount != null && effective !== full;
  return { full, effective, currency, hasFaReduction };
}

/**
 * Pure: build the whole fee statement from normalized rows. No IO, no client.
 * Enrollments are emitted in the order given (callers pass them pre-sorted).
 */
export function buildFeeStatement(
  input: FeeStatementInput,
  asOf: Date
): FeeStatementData {
  const currentCycle = firstOfMonth(asOf);

  // monthly_payments grouped by enrollment → cycle_month → row.
  const paymentsByEnrollment = new Map<
    string,
    Map<string, FeeMonthlyPaymentInput>
  >();
  for (const p of input.monthlyPayments) {
    let byCycle = paymentsByEnrollment.get(p.enrollmentId);
    if (!byCycle) {
      byCycle = new Map();
      paymentsByEnrollment.set(p.enrollmentId, byCycle);
    }
    byCycle.set(p.cycleMonth, p);
  }

  // Per-currency running totals — never merged across currencies.
  const totalsByCurrency = new Map<string, CurrencyTotal>();
  const bump = (currency: string, state: PayState, amount: number) => {
    let t = totalsByCurrency.get(currency);
    if (!t) {
      t = { currency, paid: 0, pending: 0, owed: 0 };
      totalsByCurrency.set(currency, t);
    }
    if (state === "paid") t.paid += amount;
    else if (state === "pending") t.pending += amount;
    else if (state === "owed") t.owed += amount;
    // rejected / waived / no_fee never contribute to money totals.
  };

  const enrollments: FeeEnrollment[] = input.enrollments.map((e) => {
    const { full, effective, currency, hasFaReduction } = resolveAmounts(e);
    const fullWaiver = e.faApprovedAmount === 0;
    const nonBillable = !!e.paymentMethod && NON_BILLABLE_METHODS.has(e.paymentMethod);
    const faPending = e.faRequested && !e.faReviewedAt;

    const base: FeeEnrollment = {
      enrollmentId: e.enrollmentId,
      offeringId: e.offeringId,
      title: e.offeringTitle,
      feeType: e.feeType,
      currency,
      enrolledAt: e.createdAt,
    };

    if (e.feeType === "one_time") {
      let state: PayState;
      let paidAmount = 0;
      if (e.status === "rejected") {
        state = "rejected";
      } else if (e.status === "pending") {
        state = "pending";
      } else {
        // approved
        if (nonBillable) state = "waived";
        else if (effective === 0) state = fullWaiver ? "waived" : "no_fee";
        else state = "paid";
      }
      if (state === "paid") {
        paidAmount = e.paymentAmount > 0 ? e.paymentAmount : effective;
      }
      const amountForTotal = state === "paid" ? paidAmount : effective;
      bump(currency, state, amountForTotal);
      base.oneTime = {
        state,
        fullAmount: full,
        effectiveAmount: effective,
        paidAmount,
        hasFaReduction: hasFaReduction && !fullWaiver,
        receiptUrl: e.paymentReceiptUrl,
      };
      return base;
    }

    // monthly
    const monthly: FeeEnrollmentMonthly = {
      monthlyAmount: effective,
      fullAmount: full,
      hasFaReduction: hasFaReduction && !fullWaiver,
      enrollmentState: null,
      faPending,
      cycles: [],
      paidCount: 0,
      pendingCount: 0,
      owedCount: 0,
    };

    if (e.status !== "approved") {
      // Billing hasn't started — surface the enrollment-level state, no cycles.
      monthly.enrollmentState = e.status === "rejected" ? "rejected" : "pending";
      base.monthly = monthly;
      return base;
    }

    const byCycle = paymentsByEnrollment.get(e.enrollmentId) ?? new Map();
    const billable = cyclesBetween(e.createdAt, asOf);
    // Union of billable cycles and any cycle that already has a row, sorted.
    const keys = Array.from(
      new Set<string>([...billable, ...byCycle.keys()])
    ).sort();

    for (const key of keys) {
      const row = byCycle.get(key) as FeeMonthlyPaymentInput | undefined;
      let state: PayState;
      if (fullWaiver || nonBillable) {
        state = "waived";
      } else if (faPending) {
        // FA under review — not yet owed, not yet waived.
        state = "pending";
      } else if (row) {
        if (row.status === "approved") state = "paid";
        else if (row.status === "pending") state = "pending";
        else if (row.status === "rejected") state = "rejected";
        else state = "owed"; // 'owed' placeholder row
      } else {
        state = "owed";
      }

      const amount = row?.amount ?? effective;
      const cycleCurrency = (row?.currency || currency).toUpperCase();
      bump(cycleCurrency, state, amount);
      if (state === "paid") monthly.paidCount += 1;
      else if (state === "pending") monthly.pendingCount += 1;
      else if (state === "owed") monthly.owedCount += 1;

      monthly.cycles.push({
        cycleKey: key,
        label: formatCycleMonth(key),
        period: formatCyclePeriod(key),
        state,
        amount,
        currency: cycleCurrency,
        isCurrent: key === currentCycle,
      });
    }

    // Newest cycle first in the ledger.
    monthly.cycles.reverse();
    base.monthly = monthly;
    return base;
  });

  const currencies = Array.from(totalsByCurrency.keys()).sort(
    (a, b) => currencyRank(a) - currencyRank(b)
  );
  const totals = currencies.map((c) => totalsByCurrency.get(c)!);

  return {
    studentId: input.studentId,
    studentName: input.studentName,
    enrollments,
    totals,
    currencies,
    asOf: currentCycle,
    hasActivity: input.enrollments.length > 0,
  };
}

function currencyRank(code: string): number {
  const i = CURRENCY_ORDER.indexOf(code);
  return i === -1 ? CURRENCY_ORDER.length : i;
}

/**
 * Fetch + build a student's live fee statement. Pass an RLS-scoped client for a
 * student reading her own statement (she may only ever see her own enrollments
 * and payments — the same page proves RLS is sufficient), or a service-role
 * admin client for a staff member viewing another student's — always gate the
 * caller by role first. `studentName` is looked up when not supplied.
 */
export async function fetchFeeStatementForStudent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  studentId: string,
  studentName?: string,
  asOf: Date = new Date()
): Promise<FeeStatementData> {
  const empty = (name: string): FeeStatementData => ({
    studentId,
    studentName: name,
    enrollments: [],
    totals: [],
    currencies: [],
    asOf: firstOfMonth(asOf),
    hasActivity: false,
  });

  let name = studentName ?? "";
  if (!name) {
    const { data: prof } = await client
      .from("profiles")
      .select("full_name")
      .eq("id", studentId)
      .single();
    name = prof?.full_name ?? "Student";
  }

  const { data: enrollRows } = await client
    .from("enrollments")
    .select(
      "id, offering_id, status, payment_method, payment_currency, payment_amount, payment_receipt_url, created_at, fa_requested, fa_reviewed_at, fa_approved_amount, offering:offerings!enrollments_offering_id_fkey(id, title, fee_type, price, price_inr, price_usd)"
    )
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });

  type EnrollRow = {
    id: string;
    offering_id: string;
    status: EnrollmentStatus;
    payment_method: string | null;
    payment_currency: string | null;
    payment_amount: number | null;
    payment_receipt_url: string | null;
    created_at: string;
    fa_requested: boolean | null;
    fa_reviewed_at: string | null;
    fa_approved_amount: number | null;
    offering:
      | {
          id: string;
          title: string;
          fee_type: FeeType;
          price: number;
          price_inr: number | null;
          price_usd: number | null;
        }
      | {
          id: string;
          title: string;
          fee_type: FeeType;
          price: number;
          price_inr: number | null;
          price_usd: number | null;
        }[]
      | null;
  };

  const rows = (enrollRows ?? []) as EnrollRow[];
  const enrollments: FeeEnrollmentInput[] = [];
  for (const r of rows) {
    const off = Array.isArray(r.offering) ? r.offering[0] ?? null : r.offering;
    if (!off) continue;
    enrollments.push({
      enrollmentId: r.id,
      offeringId: off.id,
      offeringTitle: off.title,
      feeType: off.fee_type,
      status: r.status,
      paymentMethod: r.payment_method ?? "",
      paymentCurrency: r.payment_currency ?? "PKR",
      paymentAmount: Number(r.payment_amount ?? 0),
      paymentReceiptUrl: r.payment_receipt_url,
      createdAt: r.created_at,
      faRequested: !!r.fa_requested,
      faReviewedAt: r.fa_reviewed_at,
      faApprovedAmount: r.fa_approved_amount,
      offeringPrice: Number(off.price),
      offeringPriceInr: off.price_inr == null ? null : Number(off.price_inr),
      offeringPriceUsd: off.price_usd == null ? null : Number(off.price_usd),
    });
  }

  if (enrollments.length === 0) return empty(name);

  const { data: mpRows } = await client
    .from("monthly_payments")
    .select("enrollment_id, cycle_month, status, amount, currency")
    .eq("student_id", studentId);

  const monthlyPayments: FeeMonthlyPaymentInput[] = (
    (mpRows ?? []) as Array<{
      enrollment_id: string;
      cycle_month: string;
      status: string;
      amount: number;
      currency: string;
    }>
  ).map((m) => ({
    enrollmentId: m.enrollment_id,
    cycleMonth: m.cycle_month,
    status: m.status,
    amount: Number(m.amount),
    currency: m.currency,
  }));

  return buildFeeStatement(
    { studentId, studentName: name, enrollments, monthlyPayments },
    asOf
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Level 3 — the per-course fee roster.
 *
 * The roster is the "who" above a single student's statement: for one offering,
 * every enrolled student resolved to a headline fee state, so staff can scan who
 * needs chasing. It reuses `buildFeeStatement` per student verbatim — a roster
 * row can therefore never disagree with the statement it links to.
 * ───────────────────────────────────────────────────────────────────────── */

export interface FeeRosterStudentInput {
  studentId: string;
  studentName: string;
  enrollment: FeeEnrollmentInput;
}

export interface FeeRosterInput {
  offeringId: string;
  offeringTitle: string;
  feeType: FeeType;
  students: FeeRosterStudentInput[];
  monthlyPayments: FeeMonthlyPaymentInput[];
}

export interface FeeRosterRow {
  studentId: string;
  studentName: string;
  enrollmentId: string;
  feeType: FeeType;
  currency: string;
  /** Headline chip for the student on this course. */
  status: PayState;
  enrolledAt: string;
  owedAmount: number;
  pendingAmount: number;
  paidAmount: number;
  /** Monthly only — otherwise 0. */
  owedCount: number;
  pendingCount: number;
  paidCount: number;
}

export interface FeeRosterData {
  offeringId: string;
  offeringTitle: string;
  feeType: FeeType;
  rows: FeeRosterRow[];
  /** Aggregated across all students, per currency, never blended. */
  totals: CurrencyTotal[];
  currencies: string[];
  totalStudents: number;
  owedStudents: number;
  pendingStudents: number;
}

/** Sort key: who needs chasing first (owed → in review → the rest), then name. */
function statusRank(state: PayState): number {
  switch (state) {
    case "owed":
      return 0;
    case "pending":
      return 1;
    case "rejected":
      return 2;
    case "paid":
      return 3;
    case "waived":
      return 4;
    case "no_fee":
      return 5;
    default:
      return 6;
  }
}

/** Reduce one student's resolved enrollment on this course to a headline state. */
function headlineState(e: FeeEnrollment): PayState {
  if (e.oneTime) return e.oneTime.state;
  const m = e.monthly!;
  if (m.enrollmentState) return m.enrollmentState;
  if (m.owedCount > 0) return "owed";
  if (m.pendingCount > 0) return "pending";
  if (m.paidCount > 0) return "paid";
  // No dues counted — either no cycle has started, or every cycle is waived.
  if (m.cycles.length > 0 && m.cycles.every((c) => c.state === "waived"))
    return "waived";
  return "paid";
}

/**
 * Pure: build a course's fee roster from normalized rows. Delegates every
 * student's money resolution to `buildFeeStatement`, so the roster and the
 * statement are computed by exactly the same code.
 */
export function buildFeeRoster(
  input: FeeRosterInput,
  asOf: Date
): FeeRosterData {
  const totalsByCurrency = new Map<string, CurrencyTotal>();
  const bump = (t: CurrencyTotal) => {
    let acc = totalsByCurrency.get(t.currency);
    if (!acc) {
      acc = { currency: t.currency, paid: 0, pending: 0, owed: 0 };
      totalsByCurrency.set(t.currency, acc);
    }
    acc.paid += t.paid;
    acc.pending += t.pending;
    acc.owed += t.owed;
  };

  const rows: FeeRosterRow[] = input.students.map((s) => {
    const stmt = buildFeeStatement(
      {
        studentId: s.studentId,
        studentName: s.studentName,
        enrollments: [s.enrollment],
        monthlyPayments: input.monthlyPayments.filter(
          (m) => m.enrollmentId === s.enrollment.enrollmentId
        ),
      },
      asOf
    );
    const fe = stmt.enrollments[0];
    const total = stmt.totals[0] ?? {
      currency: fe.currency,
      paid: 0,
      pending: 0,
      owed: 0,
    };
    for (const t of stmt.totals) bump(t);
    const status = headlineState(fe);
    return {
      studentId: s.studentId,
      studentName: s.studentName,
      enrollmentId: fe.enrollmentId,
      feeType: fe.feeType,
      currency: fe.currency,
      status,
      enrolledAt: fe.enrolledAt,
      owedAmount: total.owed,
      pendingAmount: total.pending,
      paidAmount: total.paid,
      owedCount: fe.monthly?.owedCount ?? 0,
      pendingCount: fe.monthly?.pendingCount ?? 0,
      paidCount: fe.monthly?.paidCount ?? 0,
    };
  });

  rows.sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status);
    if (r !== 0) return r;
    return a.studentName.localeCompare(b.studentName);
  });

  const currencies = Array.from(totalsByCurrency.keys()).sort(
    (a, b) => currencyRank(a) - currencyRank(b)
  );

  return {
    offeringId: input.offeringId,
    offeringTitle: input.offeringTitle,
    feeType: input.feeType,
    rows,
    totals: currencies.map((c) => totalsByCurrency.get(c)!),
    currencies,
    totalStudents: rows.length,
    owedStudents: rows.filter((r) => r.status === "owed").length,
    pendingStudents: rows.filter((r) => r.status === "pending").length,
  };
}

/** The select string for a roster enrollment row (with the student's name). */
const ROSTER_ENROLLMENT_SELECT =
  "id, student_id, offering_id, status, payment_method, payment_currency, payment_amount, payment_receipt_url, created_at, fa_requested, fa_reviewed_at, fa_approved_amount, student:profiles!enrollments_student_id_fkey(full_name)";

interface OfferingRow {
  id: string;
  title: string;
  fee_type: FeeType;
  price: number;
  price_inr: number | null;
  price_usd: number | null;
}

interface RosterEnrollmentRow {
  id: string;
  student_id: string | null;
  offering_id: string;
  status: EnrollmentStatus;
  payment_method: string | null;
  payment_currency: string | null;
  payment_amount: number | null;
  payment_receipt_url: string | null;
  created_at: string;
  fa_requested: boolean | null;
  fa_reviewed_at: string | null;
  fa_approved_amount: number | null;
  student: { full_name: string | null } | { full_name: string | null }[] | null;
}

/** Turn a joined enrollment row + its offering into the roster student input. */
function toRosterStudent(
  r: RosterEnrollmentRow,
  offering: OfferingRow
): FeeRosterStudentInput | null {
  if (!r.student_id) return null;
  const prof = Array.isArray(r.student) ? r.student[0] ?? null : r.student;
  return {
    studentId: r.student_id,
    studentName: prof?.full_name ?? "Student",
    enrollment: {
      enrollmentId: r.id,
      offeringId: offering.id,
      offeringTitle: offering.title,
      feeType: offering.fee_type,
      status: r.status,
      paymentMethod: r.payment_method ?? "",
      paymentCurrency: r.payment_currency ?? "PKR",
      paymentAmount: Number(r.payment_amount ?? 0),
      paymentReceiptUrl: r.payment_receipt_url,
      createdAt: r.created_at,
      faRequested: !!r.fa_requested,
      faReviewedAt: r.fa_reviewed_at,
      faApprovedAmount: r.fa_approved_amount,
      offeringPrice: Number(offering.price),
      offeringPriceInr: offering.price_inr == null ? null : Number(offering.price_inr),
      offeringPriceUsd: offering.price_usd == null ? null : Number(offering.price_usd),
    },
  };
}

/**
 * Fetch + build one course's fee roster. Staff-only surface — always gate the
 * caller by role first (the two payments pages that call this live behind the
 * admin billing gate, which admits only admins and treasurers). Rejected
 * enrollments are excluded — they are not on the course.
 */
export async function fetchFeeRosterForOffering(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  offeringId: string,
  asOf: Date = new Date()
): Promise<FeeRosterData | null> {
  const { data: offering } = await client
    .from("offerings")
    .select("id, title, fee_type, price, price_inr, price_usd")
    .eq("id", offeringId)
    .single<OfferingRow>();
  if (!offering) return null;

  const { data: enrollRows } = await client
    .from("enrollments")
    .select(ROSTER_ENROLLMENT_SELECT)
    .eq("offering_id", offeringId)
    .neq("status", "rejected")
    .order("created_at", { ascending: true });

  const students: FeeRosterStudentInput[] = [];
  for (const r of (enrollRows ?? []) as RosterEnrollmentRow[]) {
    const s = toRosterStudent(r, offering);
    if (s) students.push(s);
  }

  const { data: mpRows } = await client
    .from("monthly_payments")
    .select("enrollment_id, cycle_month, status, amount, currency")
    .eq("offering_id", offeringId);

  const monthlyPayments: FeeMonthlyPaymentInput[] = (
    (mpRows ?? []) as Array<{
      enrollment_id: string;
      cycle_month: string;
      status: string;
      amount: number;
      currency: string;
    }>
  ).map((m) => ({
    enrollmentId: m.enrollment_id,
    cycleMonth: m.cycle_month,
    status: m.status,
    amount: Number(m.amount),
    currency: m.currency,
  }));

  return buildFeeRoster(
    {
      offeringId: offering.id,
      offeringTitle: offering.title,
      feeType: offering.fee_type,
      students,
      monthlyPayments,
    },
    asOf
  );
}

/**
 * Fetch + build the roster for EVERY offering in one pass (the "By course"
 * index). Three list queries, then group in memory and reuse `buildFeeRoster`
 * per offering — so the index summaries match each course's roster exactly.
 * Returns rosters sorted by outstanding pressure (most students owing first).
 */
export async function fetchFeeRosterIndex(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  asOf: Date = new Date()
): Promise<FeeRosterData[]> {
  const { data: offeringRows } = await client
    .from("offerings")
    .select("id, title, fee_type, price, price_inr, price_usd")
    .order("title", { ascending: true });
  const offerings = (offeringRows ?? []) as OfferingRow[];
  if (offerings.length === 0) return [];
  const offeringById = new Map(offerings.map((o) => [o.id, o]));

  const { data: enrollRows } = await client
    .from("enrollments")
    .select(ROSTER_ENROLLMENT_SELECT)
    .neq("status", "rejected")
    .order("created_at", { ascending: true });

  const studentsByOffering = new Map<string, FeeRosterStudentInput[]>();
  for (const r of (enrollRows ?? []) as RosterEnrollmentRow[]) {
    const offering = offeringById.get(r.offering_id);
    if (!offering) continue;
    const s = toRosterStudent(r, offering);
    if (!s) continue;
    const list = studentsByOffering.get(r.offering_id) ?? [];
    list.push(s);
    studentsByOffering.set(r.offering_id, list);
  }

  const { data: mpRows } = await client
    .from("monthly_payments")
    .select("enrollment_id, offering_id, cycle_month, status, amount, currency");

  const paymentsByOffering = new Map<string, FeeMonthlyPaymentInput[]>();
  for (const m of (mpRows ?? []) as Array<{
    enrollment_id: string;
    offering_id: string;
    cycle_month: string;
    status: string;
    amount: number;
    currency: string;
  }>) {
    const list = paymentsByOffering.get(m.offering_id) ?? [];
    list.push({
      enrollmentId: m.enrollment_id,
      cycleMonth: m.cycle_month,
      status: m.status,
      amount: Number(m.amount),
      currency: m.currency,
    });
    paymentsByOffering.set(m.offering_id, list);
  }

  const rosters = offerings
    .map((o) =>
      buildFeeRoster(
        {
          offeringId: o.id,
          offeringTitle: o.title,
          feeType: o.fee_type,
          students: studentsByOffering.get(o.id) ?? [],
          monthlyPayments: paymentsByOffering.get(o.id) ?? [],
        },
        asOf
      )
    )
    .filter((r) => r.totalStudents > 0);

  rosters.sort((a, b) => {
    if (b.owedStudents !== a.owedStudents) return b.owedStudents - a.owedStudents;
    if (b.pendingStudents !== a.pendingStudents)
      return b.pendingStudents - a.pendingStudents;
    return a.offeringTitle.localeCompare(b.offeringTitle);
  });

  return rosters;
}

// ── Level 1: institute-wide fee overview ────────────────────────────────────
// The top of the ladder. It never does its own money math — it folds the
// per-course rosters (Level 3) into one institute rollup, per currency, so the
// numbers can never disagree with the course and student views beneath it.

export interface InstituteCourseLine {
  offeringId: string;
  offeringTitle: string;
  feeType: FeeType;
  owedStudents: number;
  pendingStudents: number;
  totalStudents: number;
  /** This course's owed amount(s), per currency, owed > 0 only. */
  owedTotals: CurrencyTotal[];
}

export interface InstituteFeeOverview {
  /** Institute totals, per currency, never blended. */
  totals: CurrencyTotal[];
  currencies: string[];
  courseCount: number;
  /** Distinct students enrolled across all courses (by enrollment, not person). */
  enrollmentCount: number;
  studentsOwing: number;
  studentsInReview: number;
  coursesOwing: number;
  /** Courses that need chasing, worst first (already sorted by the index). */
  attention: InstituteCourseLine[];
}

/** Fold per-course rosters into one institute rollup. Pure. */
export function summariseInstituteFees(
  rosters: FeeRosterData[]
): InstituteFeeOverview {
  const totalsByCurrency = new Map<string, CurrencyTotal>();
  const bump = (t: CurrencyTotal) => {
    let acc = totalsByCurrency.get(t.currency);
    if (!acc) {
      acc = { currency: t.currency, paid: 0, pending: 0, owed: 0 };
      totalsByCurrency.set(t.currency, acc);
    }
    acc.paid += t.paid;
    acc.pending += t.pending;
    acc.owed += t.owed;
  };

  let enrollmentCount = 0;
  let studentsOwing = 0;
  let studentsInReview = 0;
  let coursesOwing = 0;

  for (const r of rosters) {
    for (const t of r.totals) bump(t);
    enrollmentCount += r.totalStudents;
    studentsOwing += r.owedStudents;
    studentsInReview += r.pendingStudents;
    if (r.owedStudents > 0) coursesOwing += 1;
  }

  const currencies = Array.from(totalsByCurrency.keys()).sort(
    (a, b) => currencyRank(a) - currencyRank(b)
  );

  const attention: InstituteCourseLine[] = rosters
    .filter((r) => r.owedStudents > 0 || r.pendingStudents > 0)
    .map((r) => ({
      offeringId: r.offeringId,
      offeringTitle: r.offeringTitle,
      feeType: r.feeType,
      owedStudents: r.owedStudents,
      pendingStudents: r.pendingStudents,
      totalStudents: r.totalStudents,
      owedTotals: r.totals.filter((t) => t.owed > 0),
    }));

  return {
    totals: currencies.map((c) => totalsByCurrency.get(c)!),
    currencies,
    courseCount: rosters.length,
    enrollmentCount,
    studentsOwing,
    studentsInReview,
    coursesOwing,
    attention,
  };
}

/** Fetch every course roster, then fold them into the institute overview. */
export async function fetchInstituteFeeOverview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  asOf: Date = new Date()
): Promise<InstituteFeeOverview> {
  const rosters = await fetchFeeRosterIndex(client, asOf);
  return summariseInstituteFees(rosters);
}
