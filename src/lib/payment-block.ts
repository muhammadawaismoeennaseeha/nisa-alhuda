/**
 * Payment-block gate — decides whether a student should be locked out of
 * the portal because she hasn't paid her monthly fee for too long.
 *
 * Rules (from spec):
 *  • Block when the current cycle is owed and the cycle has been running
 *    for at least BLOCK_AFTER_DAYS (10) days — i.e. block first kicks in
 *    on the 6th of the fee month (cycle starts on the 27th of the prior
 *    month, so the 6th = day 10). Sisters keep portal access through
 *    the 5th of the fee month even if the receipt isn't in yet.
 *
 *    The admin "Awaiting Submission" chase list (see
 *    `src/app/dashboard/admin/payments/page.tsx`) uses its own T+5
 *    threshold and is intentionally decoupled — admins see the sister
 *    on their worklist ~5 days before the block hits, so there's a
 *    window to reach out manually before automatic lockout.
 *  • Exemptions — these enrollments DON'T contribute to a block:
 *    - 100% Financial Assistance (fa_approved_amount === 0)
 *    - Non-billable methods (manual_approval / waiver / free)
 *    - Pending FA application (fa_requested=true with no decision yet)
 *    - Pending receipt uploaded (monthly_payments.status === 'pending')
 *    - Already approved this cycle
 *  • A sister is blocked if ANY of her approved monthly enrollments lands
 *    in the blocking bucket. (She has to clear them all to unblock; a single
 *    unpaid cycle is enough to lock her out.)
 *  • Admin override (lock_override column on profiles):
 *    - null  → auto mode — this function's verdict is used
 *    - true  → force-locked — returns a synthetic BlockingDebt even if
 *              she's paid up, so she can't access the portal
 *    - false → force-unlocked — returns null even if she's overdue
 *
 * The page-level guard lives in `src/app/dashboard/layout.tsx` — this file
 * only computes the verdict. Keeping the policy here means we can reuse it
 * later (e.g. an admin "what does she see" preview) without duplicating
 * logic.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CYCLE_START_DAY,
  cyclesBetween,
  firstOfMonth,
  formatCycleMonth,
  monthlyAmountForEnrollment,
} from "@/lib/monthly-payments";
import type { Enrollment, Offering } from "@/lib/types/database";

/**
 * Days after cycle start (27th of prior month) before the lockout kicks in.
 * 10 = block first fires on the 6th of the fee month; the 5th is still a
 * safe day for the sister to upload her receipt.
 */
export const BLOCK_AFTER_DAYS = 10;

/** Non-billable payment methods — sisters on these never owe a monthly fee. */
export const NON_BILLABLE_METHODS = new Set(["manual_approval", "waiver", "free"]);

export interface BlockingEntry {
  enrollmentId: string;
  offeringTitle: string;
  amount: number;
  currency: string;
  cycleLabel: string;
  daysOverdue: number;
}

export interface BlockingDebt {
  entries: BlockingEntry[];
  /** Sum of all `amount`s — only meaningful when every entry shares one currency. */
  totalAmount: number;
  /** Distinct currency codes across `entries`. If >1, callers should show per-line totals only. */
  currencies: string[];
  /**
   * When true this block was set manually by an admin (lock_override=true),
   * not triggered by unpaid fees. The UI should show a different message.
   */
  isManualLock?: boolean;
  /** Admin note attached to the manual lock, if any. */
  manualLockNote?: string | null;
}

/**
 * Returns the blocking debt for a profile, or `null` if she's allowed through.
 *
 * Called from the dashboard layout once per request for every student. If
 * this returns non-null and the request is not for the monthly-payment
 * page, the layout renders the block screen instead of the normal UI.
 *
 * Also accepts the profile's lock_override fields so the function can
 * short-circuit before any DB queries when the override is set.
 */
export async function getBlockingDebt(
  supabase: SupabaseClient,
  profileId: string,
  opts?: {
    lockOverride?: boolean | null;
    lockOverrideNote?: string | null;
  }
): Promise<BlockingDebt | null> {
  // ── Admin manual override (short-circuit before any DB work) ──────────────
  if (opts?.lockOverride === true) {
    // Force-locked by admin — return a synthetic debt so the layout shows
    // the locked screen. The LockedContent component renders a different
    // message when isManualLock=true.
    return {
      entries: [],
      totalAmount: 0,
      currencies: [],
      isManualLock: true,
      manualLockNote: opts.lockOverrideNote ?? null,
    };
  }
  if (opts?.lockOverride === false) {
    // Force-unlocked by admin — skip the auto-check entirely.
    return null;
  }
  // ── Auto mode (lock_override === null) ────────────────────────────────────

  const currentCycle = firstOfMonth();

  // Days since cycle start. Cycle key is YYYY-MM-27 UTC; compare against
  // wall-clock UTC midnight so the count rolls over predictably.
  //
  // NOTE: the grace period is applied PER CYCLE inside the loop below, not
  // here. Returning early on `daysOverdue < BLOCK_AFTER_DAYS` would also
  // suppress arrears from *previous* months for the first 10 days of every
  // new cycle, letting a sister who has never paid walk in from the 27th to
  // the 5th, every single month.
  const daysOverdue = daysSinceCycleStart(currentCycle);

  type EnrollmentRow = Enrollment & {
    offering: Pick<
      Offering,
      "id" | "title" | "fee_type" | "price" | "price_inr" | "price_usd"
    > | null;
  };

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(
      "id, student_id, offering_id, status, payment_method, payment_currency, fa_requested, fa_reviewed_at, fa_approved_amount, created_at, offering:offerings!enrollments_offering_id_fkey(id, title, fee_type, price, price_inr, price_usd)"
    )
    .eq("student_id", profileId)
    .eq("status", "approved");

  const rows = (enrollments as EnrollmentRow[] | null) ?? [];
  if (rows.length === 0) return null;

  const monthlyEnrollments = rows.filter(
    (e) => e.offering?.fee_type === "monthly"
  );
  if (monthlyEnrollments.length === 0) return null;

  // Pull ALL payment rows for this student across ALL cycles — we want to
  // detect unpaid cycles from any month, not just the current one.
  // Filtering to the current cycle only would miss July/August arrears when
  // the sister skips a month then submits something for a later cycle.
  const { data: allPayments } = await supabase
    .from("monthly_payments")
    .select("enrollment_id, cycle_month, status")
    .eq("student_id", profileId);

  // Build a lookup: (enrollmentId, cycleMonth) → status
  // so the inner loop can check any cycle in O(1).
  const statusByKey: Record<string, string> = {};
  for (const row of (allPayments as Array<{
    enrollment_id: string;
    cycle_month: string;
    status: string;
  }> | null) ?? []) {
    statusByKey[`${row.enrollment_id}::${row.cycle_month}`] = row.status;
  }

  const entries: BlockingEntry[] = [];

  for (const enrollment of monthlyEnrollments) {
    const offering = enrollment.offering;
    if (!offering) continue;

    // Exemption: 100% FA waiver.
    if (enrollment.fa_approved_amount === 0) continue;

    // Exemption: non-billable payment method.
    if (
      enrollment.payment_method &&
      NON_BILLABLE_METHODS.has(enrollment.payment_method)
    ) {
      continue;
    }

    // Exemption: pending FA application (requested, not yet reviewed).
    if (enrollment.fa_requested && !enrollment.fa_reviewed_at) continue;

    // All cycles this enrollment has ever owed, up to and including today's.
    const owedCycles = cyclesBetween(enrollment.created_at);
    if (owedCycles.length === 0) continue;

    // Find the most-recent unpaid cycle (the one that will trigger the block).
    // We check cycles in reverse-chronological order: the newest overdue cycle
    // is what we show to the student so she pays the current month first.
    //
    // A cycle is "unpaid" if its payment row is missing, or has status
    // "owed" (cron placeholder). "pending" (uploaded, awaiting review) and
    // "approved" are both exempt.
    //
    // Note: we only block if the cycle has been running for at least
    // BLOCK_AFTER_DAYS (10) days. That check is applied to the current cycle
    // inside the loop. Past cycles that are still owed are automatically past
    // that threshold and always trigger a block — she had the full grace
    // period already.
    let blockingCycle: string | null = null;
    for (let i = owedCycles.length - 1; i >= 0; i--) {
      const cycle = owedCycles[i];
      const key = `${enrollment.id}::${cycle}`;
      const status = statusByKey[key];

      // Exempt if she's submitted or paid.
      if (status === "pending" || status === "approved") continue;

      // For the current cycle: only block if past grace period.
      if (cycle === currentCycle) {
        if (daysOverdue < BLOCK_AFTER_DAYS) continue;
      }

      // This cycle is owed (status='owed' or missing row entirely).
      blockingCycle = cycle;
      break; // Show the most recent unpaid cycle — one entry per enrollment.
    }

    if (!blockingCycle) continue;

    // daysOverdue for the blocking cycle.
    const cycleOverdue =
      blockingCycle === currentCycle
        ? daysOverdue
        : daysSinceCycleStart(blockingCycle);

    const { amount, currency } = monthlyAmountForEnrollment(
      offering,
      enrollment
    );
    entries.push({
      enrollmentId: enrollment.id,
      offeringTitle: offering.title,
      amount,
      currency,
      cycleLabel: formatCycleMonth(blockingCycle),
      daysOverdue: cycleOverdue,
    });
  }

  if (entries.length === 0) return null;

  const currencies = Array.from(new Set(entries.map((e) => e.currency)));
  const totalAmount =
    currencies.length === 1
      ? entries.reduce((sum, e) => sum + e.amount, 0)
      : 0;

  return { entries, totalAmount, currencies };
}

/**
 * Days elapsed since the given cycle started, in whole UTC days.
 * Returns 0 on the cycle-start day itself, 1 the day after, etc.
 */
function daysSinceCycleStart(cycleKey: string): number {
  const [y, m, d] = cycleKey.split("-").map(Number);
  const start = Date.UTC(y, (m || 1) - 1, d || CYCLE_START_DAY);
  const today = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  );
  const diffMs = today - start;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
