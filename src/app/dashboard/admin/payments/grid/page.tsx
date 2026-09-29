/**
 * Billing Grid — the "Excel sheet" view of payments inside the LMS.
 *
 * Layout: sisters down, cycle-months across, totals on the right.
 * Each cell shows the payment status for that sister × that cycle:
 *   - "Initial" → the enrollment payment (lives on `enrollments` row)
 *   - "Monthly" → a `monthly_payments` row
 *   - "Owed"    → cycle in the past, no row yet (visible to admin only)
 *   - blank     → either pre-enrollment or a one-time offering's post-initial cycles
 *
 * Scope: ALL approved/pending/rejected enrollments across ALL offerings
 * (one-time + monthly). Client component handles search + status filter +
 * CSV export + click-cell-to-act.
 *
 * Access: admin OR treasurer (mirrors the existing /dashboard/admin/payments
 * scope so the role gate doesn't need extending).
 */
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { ClipboardList } from "lucide-react";
import {
  firstOfMonth,
  monthlyAmountForEnrollment,
  FIRST_BILLABLE_CYCLE,
} from "@/lib/monthly-payments";
import type {
  Enrollment,
  Offering,
  MonthlyPayment,
  Profile,
  MonthlyPaymentStatus,
} from "@/lib/types/database";
import { BillingGrid, type GridRow, type CycleColumn } from "./billing-grid";

/** Cap the number of cycle columns so the grid doesn't blow horizontally
 *  for ancient enrollments. Treasurer rarely needs more than ~12 months. */
const MAX_CYCLE_COLUMNS = 12;

/** Build the cycle keys (YYYY-MM-DD anchored on 27th) from earliest visible
 *  enrollment cycle through the current cycle, capped at MAX. */
function buildCycleColumns(
  enrollments: { created_at: string }[]
): CycleColumn[] {
  if (enrollments.length === 0) return [];
  const currentCycleKey = firstOfMonth();
  const earliestCycleKey = enrollments
    .map((e) => firstOfMonth(new Date(e.created_at)))
    .sort()[0];

  // Walk forward month-by-month from earliest cycle through current cycle.
  // `day` is always 27 (CYCLE_START_DAY) — never reassigned.
  const keys: string[] = [];
  const [startYear, startMonth, day] = earliestCycleKey.split("-").map(Number);
  let year = startYear;
  let month = startMonth;
  for (let i = 0; i < 240; i++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    keys.push(key);
    if (key === currentCycleKey) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  // Trim to last MAX_CYCLE_COLUMNS so very old enrollments don't explode width.
  const trimmed = keys.slice(-MAX_CYCLE_COLUMNS);

  return trimmed.map((key) => ({
    key,
    // Display label: "May 2026" — using UTC parse to avoid timezone drift.
    label: new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
  }));
}

export default async function BillingGridPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<Pick<Profile, "role">>();

  if (profile?.role !== "admin" && profile?.role !== "treasurer") {
    return (
      <div className="py-20 text-center">
        <p className="font-medium text-destructive">Access denied.</p>
      </div>
    );
  }

  // ── Pull everything we need in parallel ──
  const [enrRes, payRes] = await Promise.all([
    supabase
      .from("enrollments")
      .select(
        "id, student_id, offering_id, applicant_email, status, payment_method, payment_amount, payment_currency, payment_receipt_url, fa_approved_amount, created_at, student_details, student:profiles!enrollments_student_id_fkey(full_name, phone), offering:offerings!enrollments_offering_id_fkey(id, title, fee_type, price, price_inr, price_usd)"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("monthly_payments")
      .select(
        "id, enrollment_id, cycle_month, amount, currency, status, receipt_url, reviewed_at, sender_name"
      ),
  ]);

  type EnrollmentRow = Enrollment & {
    student: Pick<Profile, "full_name" | "phone"> | null;
    offering: Pick<
      Offering,
      "id" | "title" | "fee_type" | "price" | "price_inr" | "price_usd"
    > | null;
    student_details:
      | { first_name?: string; last_name?: string; full_name?: string }
      | null;
  };
  const enrollments = (enrRes.data || []) as unknown as EnrollmentRow[];
  const payments = (payRes.data || []) as unknown as Pick<
    MonthlyPayment,
    | "id"
    | "enrollment_id"
    | "cycle_month"
    | "amount"
    | "currency"
    | "status"
    | "receipt_url"
    | "reviewed_at"
    | "sender_name"
  >[];

  // Group monthly payments by enrollment + cycle for O(1) lookup.
  const paymentsByEnrollmentCycle = new Map<
    string,
    Map<string, (typeof payments)[number]>
  >();
  for (const p of payments) {
    if (!paymentsByEnrollmentCycle.has(p.enrollment_id)) {
      paymentsByEnrollmentCycle.set(p.enrollment_id, new Map());
    }
    paymentsByEnrollmentCycle.get(p.enrollment_id)!.set(p.cycle_month, p);
  }

  const cycleColumns = buildCycleColumns(enrollments);
  const currentCycleKey = firstOfMonth();

  // Build the grid rows.
  const rows: GridRow[] = enrollments.map((e) => {
    const offering = e.offering;
    const fullName =
      e.student?.full_name?.trim() ||
      e.student_details?.full_name?.trim() ||
      [
        e.student_details?.first_name,
        e.student_details?.last_name,
      ]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      e.applicant_email ||
      "Unknown";

    const currency = ((e.payment_currency || "PKR").toUpperCase() as
      | "PKR"
      | "INR"
      | "USD");
    const enrollmentCycle = firstOfMonth(new Date(e.created_at));
    const enrollmentCycleIndex = cycleColumns.findIndex(
      (c) => c.key === enrollmentCycle
    );

    // Expected per-cycle amount for monthly offerings (honors FA reduced fee).
    const expectedMonthly = offering
      ? monthlyAmountForEnrollment(offering, e).amount
      : 0;

    const enrollmentPaymentsMap = paymentsByEnrollmentCycle.get(e.id);

    // Walk each cycle column and decide what to render.
    const cells: GridRow["cells"] = {};
    let totalPaid = 0;
    let totalOwed = 0;
    let lastPaidAt: string | null = null;

    // For one-time offerings the initial enrollment payment IS the only fee.
    const isMonthly = offering?.fee_type === "monthly";

    for (const col of cycleColumns) {
      // Pre-enrollment columns are blank.
      if (col.key < enrollmentCycle) {
        cells[col.key] = { kind: "pre-enrollment" };
        continue;
      }

      // The enrollment's own cycle = the initial payment cell.
      if (col.key === enrollmentCycle) {
        const initialStatus = (e.status || "pending") as
          | "approved"
          | "pending"
          | "rejected";
        cells[col.key] = {
          kind: "initial",
          status: initialStatus,
          amount: e.payment_amount || 0,
          currency,
          receiptPath: e.payment_receipt_url,
          enrollmentId: e.id,
        };
        if (initialStatus === "approved") {
          totalPaid += e.payment_amount || 0;
        }
        continue;
      }

      // Past-enrollment cycles.
      if (!isMonthly) {
        // One-time offering: no further owed cycles.
        cells[col.key] = { kind: "na" };
        continue;
      }

      // Monthly: check if a monthly_payments row exists for this cycle.
      const row = enrollmentPaymentsMap?.get(col.key);
      if (row) {
        cells[col.key] = {
          kind: "monthly",
          status: row.status as MonthlyPaymentStatus,
          amount: Number(row.amount) || 0,
          currency: row.currency || currency,
          receiptPath: row.receipt_url,
          paymentId: row.id,
          senderName: row.sender_name,
        };
        if (row.status === "approved") {
          totalPaid += Number(row.amount) || 0;
          if (
            row.reviewed_at &&
            (!lastPaidAt || row.reviewed_at > lastPaidAt)
          ) {
            lastPaidAt = row.reviewed_at;
          }
        } else if (row.status === "owed" || row.status === "rejected") {
          totalOwed += Number(row.amount) || expectedMonthly;
        }
        continue;
      }

      // Monthly + no row.
      // Only mark as "owed" if (a) cycle is at or past the platform's
      // billing-start date, and (b) it's not in the future. Cycles between
      // an old enrollment and FIRST_BILLABLE_CYCLE are "na" — the system
      // wasn't billing then so showing "owed" would be misleading.
      const isBillable =
        col.key >= FIRST_BILLABLE_CYCLE && col.key <= currentCycleKey;
      if (isBillable) {
        cells[col.key] = {
          kind: "owed",
          expectedAmount: expectedMonthly,
          currency,
          enrollmentId: e.id,
          cycle: col.key,
        };
        totalOwed += expectedMonthly;
      } else {
        cells[col.key] = { kind: "na" };
      }
    }

    return {
      enrollmentId: e.id,
      studentId: e.student_id,
      studentName: fullName,
      studentPhone: e.student?.phone || null,
      studentEmail: e.applicant_email || "",
      offeringId: offering?.id || "",
      offeringTitle: offering?.title || "—",
      offeringFeeType: (offering?.fee_type as "one_time" | "monthly") || "one_time",
      enrolledAt: e.created_at,
      enrollmentStatus: (e.status as "approved" | "pending" | "rejected") || "pending",
      enrollmentCycle,
      enrollmentCycleIndex,
      currency,
      cells,
      totalPaid,
      totalOwed,
      lastPaidAt,
    };
  });

  return (
    <div>
      <PageHeader
        icon={ClipboardList}
        title="Billing Grid"
        subtitle="Spreadsheet view of every enrollment's payment across every cycle. Search, filter, export, or click a cell to act."
      />

      <BillingGrid rows={rows} cycleColumns={cycleColumns} />
    </div>
  );
}
