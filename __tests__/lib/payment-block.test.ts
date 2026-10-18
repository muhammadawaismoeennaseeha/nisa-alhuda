import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBlockingDebt, BLOCK_AFTER_DAYS } from "@/lib/payment-block";

/**
 * These tests pin down the ONE rule that is easy to get wrong:
 *
 *   The 10-day grace period belongs to a *cycle*, not to the calendar.
 *
 * A sister who owes the current month gets 10 days of breathing room
 * (27th → 5th). A sister who owes an *older* month already had hers, so
 * arrears must keep her blocked even during the next cycle's grace window.
 *
 * The bug this file guards against: a global
 * `if (daysOverdue < BLOCK_AFTER_DAYS) return null` at the top of
 * getBlockingDebt, which let a sister who had never paid a single rupee
 * walk straight into the portal from the 27th to the 5th, every month.
 */

// ─── fake supabase ─────────────────────────────────────────────────

interface PaymentRow {
  enrollment_id: string;
  cycle_month: string;
  status: string;
}

const OFFERING = {
  id: "off-1",
  title: "Tajweed Level 1",
  fee_type: "monthly",
  price: 1500,
  price_inr: null,
  price_usd: null,
};

const ENROLLMENT: Record<string, unknown> = {
  id: "enr-1",
  student_id: "stu-1",
  offering_id: "off-1",
  status: "approved",
  payment_method: "bank_transfer",
  payment_currency: "PKR",
  fa_requested: false,
  fa_reviewed_at: null,
  fa_approved_amount: null,
  created_at: "2026-06-01T00:00:00Z",
  offering: OFFERING,
};

/**
 * Minimal stand-in for the postgrest query builder: every method returns
 * `this`, and awaiting it resolves to the rows for whichever table was
 * named in `.from()`.
 */
function fakeSupabase(payments: PaymentRow[], enrollments = [ENROLLMENT]) {
  let table = "";
  const builder = {
    select: () => builder,
    eq: () => builder,
    then: (resolve: (v: { data: unknown }) => unknown) =>
      Promise.resolve({
        data: table === "enrollments" ? enrollments : payments,
      }).then(resolve),
  };
  return {
    from: (t: string) => {
      table = t;
      return builder;
    },
  } as unknown as SupabaseClient;
}

/**
 * Every cycle she owed BEFORE the current one. All the dates exercised below
 * (27 Oct → 20 Nov 2026) sit inside the `2026-10-27` cycle, so clearing these
 * four leaves exactly one cycle outstanding: the current one.
 */
const PAST_CYCLES = ["2026-06-27", "2026-07-27", "2026-08-27", "2026-09-27"];

const approvedThrough = (cycles: string[]): PaymentRow[] =>
  cycles.map((cycle_month) => ({
    enrollment_id: "enr-1",
    cycle_month,
    status: "approved",
  }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const at = (iso: string) => vi.setSystemTime(new Date(iso));

// ─── arrears: the regression ───────────────────────────────────────

describe("getBlockingDebt() — arrears from previous cycles", () => {
  // Enrolled 1 Jun 2026, never paid anything.
  const neverPaid = () => fakeSupabase([]);

  it.each([
    ["2026-10-27", "first day of the new cycle"],
    ["2026-11-01", "mid grace window"],
    ["2026-11-05", "last day of the grace window"],
  ])(
    "stays blocked on %s (%s) because older cycles are unpaid",
    async (date) => {
      at(date);
      const debt = await getBlockingDebt(neverPaid(), "stu-1");
      expect(debt).not.toBeNull();
      expect(debt!.entries).toHaveLength(1);
    }
  );

  it("names the most recent unpaid cycle she can actually clear", async () => {
    // 1 Nov 2026 sits in the Oct-27 cycle's grace window, so the newest
    // *blocking* cycle is the one before it: Sep 27 → labelled October.
    at("2026-11-01");
    const debt = await getBlockingDebt(neverPaid(), "stu-1");
    expect(debt!.entries[0].cycleLabel).toBe("October 2026");
  });

  it("blocks on the 6th once the current cycle itself goes overdue", async () => {
    at("2026-11-06");
    const debt = await getBlockingDebt(neverPaid(), "stu-1");
    expect(debt!.entries[0].cycleLabel).toBe("November 2026");
  });
});

// ─── grace: the behaviour we must not break ────────────────────────

describe("getBlockingDebt() — grace period for a paid-up sister", () => {
  // Every past cycle approved; only the current one is outstanding.
  const paidUp = () => fakeSupabase(approvedThrough(PAST_CYCLES));

  it.each(["2026-10-27", "2026-11-01", "2026-11-05"])(
    "lets her through on %s — still inside the 10-day window",
    async (date) => {
      at(date);
      expect(await getBlockingDebt(paidUp(), "stu-1")).toBeNull();
    }
  );

  it(`blocks her on day ${BLOCK_AFTER_DAYS} (6 Nov) when the receipt never arrives`, async () => {
    at("2026-11-06");
    const debt = await getBlockingDebt(paidUp(), "stu-1");
    expect(debt).not.toBeNull();
    expect(debt!.entries[0].cycleLabel).toBe("November 2026");
    expect(debt!.entries[0].daysOverdue).toBe(BLOCK_AFTER_DAYS);
  });

  it("stays unblocked when she uploads a receipt pending review", async () => {
    at("2026-11-20");
    const supabase = fakeSupabase([
      ...approvedThrough(PAST_CYCLES),
      { enrollment_id: "enr-1", cycle_month: "2026-10-27", status: "pending" },
    ]);
    expect(await getBlockingDebt(supabase, "stu-1")).toBeNull();
  });
});

// ─── admin override ────────────────────────────────────────────────

describe("getBlockingDebt() — admin lock override", () => {
  it("force-locks a paid-up sister when lock_override = true", async () => {
    at("2026-11-01");
    const debt = await getBlockingDebt(
      fakeSupabase(approvedThrough(PAST_CYCLES)),
      "stu-1",
      { lockOverride: true, lockOverrideNote: "Pending conduct review" }
    );
    expect(debt).toMatchObject({
      isManualLock: true,
      manualLockNote: "Pending conduct review",
      entries: [],
    });
  });

  it("force-unlocks a sister in arrears when lock_override = false", async () => {
    at("2026-11-01");
    const debt = await getBlockingDebt(fakeSupabase([]), "stu-1", {
      lockOverride: false,
    });
    expect(debt).toBeNull();
  });

  it("falls back to the automatic verdict when lock_override is null", async () => {
    at("2026-11-01");
    const debt = await getBlockingDebt(fakeSupabase([]), "stu-1", {
      lockOverride: null,
    });
    expect(debt).not.toBeNull();
  });
});

// ─── exemptions ────────────────────────────────────────────────────

describe("getBlockingDebt() — exemptions never block", () => {
  it.each([
    ["100% financial assistance", { fa_approved_amount: 0 }],
    ["a waiver payment method", { payment_method: "waiver" }],
    ["an undecided FA application", { fa_requested: true }],
  ])("ignores an enrollment on %s", async (_label, patch) => {
    at("2026-11-20"); // well past every grace window
    const supabase = fakeSupabase([], [{ ...ENROLLMENT, ...patch }]);
    expect(await getBlockingDebt(supabase, "stu-1")).toBeNull();
  });

  it("ignores one-off (non-monthly) offerings", async () => {
    at("2026-11-20");
    const supabase = fakeSupabase(
      [],
      [{ ...ENROLLMENT, offering: { ...OFFERING, fee_type: "one_time" } }]
    );
    expect(await getBlockingDebt(supabase, "stu-1")).toBeNull();
  });
});
