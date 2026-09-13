import { describe, it, expect } from "vitest";
import {
  buildFeeStatement,
  buildFeeRoster,
  summariseInstituteFees,
  type FeeStatementInput,
  type FeeEnrollmentInput,
  type FeeRosterStudentInput,
  type FeeRosterData,
} from "@/lib/fees";

/** Fixed as-of so cycle math is deterministic: 13 Sep 2026 → current cycle
 * key 2026-08-27 (labelled "September 2026"). First billable is 2026-05-27. */
const AS_OF = new Date("2026-09-13T00:00:00Z");

function enrollment(over: Partial<FeeEnrollmentInput> = {}): FeeEnrollmentInput {
  return {
    enrollmentId: "enr-1",
    offeringId: "off-1",
    offeringTitle: "Qur'an Foundations",
    feeType: "one_time",
    status: "approved",
    paymentMethod: "bank_transfer",
    paymentCurrency: "PKR",
    paymentAmount: 5000,
    paymentReceiptUrl: "https://example.com/r.jpg",
    createdAt: "2026-01-01T00:00:00Z",
    faRequested: false,
    faReviewedAt: null,
    faApprovedAmount: null,
    offeringPrice: 5000,
    offeringPriceInr: null,
    offeringPriceUsd: null,
    ...over,
  };
}

function build(
  enrollments: FeeEnrollmentInput[],
  monthlyPayments: FeeStatementInput["monthlyPayments"] = []
) {
  return buildFeeStatement(
    { studentId: "stu-1", studentName: "Aisha Fatima", enrollments, monthlyPayments },
    AS_OF
  );
}

describe("buildFeeStatement — one-time enrollments", () => {
  it("an approved one-time enrollment is paid and lands in the currency total", () => {
    const d = build([enrollment({ paymentAmount: 5000 })]);
    const e = d.enrollments[0];
    expect(e.oneTime?.state).toBe("paid");
    expect(e.oneTime?.paidAmount).toBe(5000);
    expect(d.totals).toEqual([{ currency: "PKR", paid: 5000, pending: 0, owed: 0 }]);
  });

  it("shows an FA reduction (full → effective) and totals the reduced paid amount", () => {
    const d = build([
      enrollment({
        offeringPrice: 15000,
        faApprovedAmount: 10000,
        paymentAmount: 10000,
      }),
    ]);
    const o = d.enrollments[0].oneTime!;
    expect(o.state).toBe("paid");
    expect(o.fullAmount).toBe(15000);
    expect(o.effectiveAmount).toBe(10000);
    expect(o.hasFaReduction).toBe(true);
    expect(d.totals[0].paid).toBe(10000);
  });

  it("a pending one-time enrollment counts as in-review, not paid", () => {
    const d = build([enrollment({ status: "pending" })]);
    expect(d.enrollments[0].oneTime?.state).toBe("pending");
    expect(d.totals[0]).toEqual({ currency: "PKR", paid: 0, pending: 5000, owed: 0 });
  });

  it("a rejected one-time enrollment is shown but excluded from money totals", () => {
    const d = build([enrollment({ status: "rejected" })]);
    expect(d.enrollments[0].oneTime?.state).toBe("rejected");
    expect(d.totals).toEqual([{ currency: "PKR", paid: 0, pending: 0, owed: 0 }]);
  });

  it("a free (price 0) course reads no_fee and never appears as owed", () => {
    const d = build([enrollment({ offeringPrice: 0, paymentAmount: 0 })]);
    expect(d.enrollments[0].oneTime?.state).toBe("no_fee");
    expect(d.totals[0]).toEqual({ currency: "PKR", paid: 0, pending: 0, owed: 0 });
  });

  it("a 100% FA waiver reads waived, not no_fee", () => {
    const d = build([
      enrollment({ offeringPrice: 5000, faApprovedAmount: 0, paymentAmount: 0 }),
    ]);
    expect(d.enrollments[0].oneTime?.state).toBe("waived");
  });
});

describe("buildFeeStatement — monthly enrollments", () => {
  const monthly = (over: Partial<FeeEnrollmentInput> = {}) =>
    enrollment({
      enrollmentId: "enr-m",
      feeType: "monthly",
      offeringPrice: 3000,
      paymentAmount: 3000,
      ...over,
    });

  it("expands into a cycle ledger from first-billable to the current cycle", () => {
    const d = build([monthly()]);
    const m = d.enrollments[0].monthly!;
    // 2026-05-27, 06-27, 07-27, 08-27 → 4 cycles.
    expect(m.cycles).toHaveLength(4);
    // newest first
    expect(m.cycles[0].label).toBe("September 2026");
    expect(m.cycles[0].isCurrent).toBe(true);
    expect(m.cycles[3].label).toBe("June 2026");
  });

  it("with no payment rows every cycle is owed and totals the whole balance", () => {
    const d = build([monthly()]);
    const m = d.enrollments[0].monthly!;
    expect(m.owedCount).toBe(4);
    expect(m.paidCount).toBe(0);
    expect(d.totals[0]).toEqual({ currency: "PKR", paid: 0, pending: 0, owed: 12000 });
  });

  it("honours approved / pending / owed rows per cycle", () => {
    const d = build(
      [monthly()],
      [
        { enrollmentId: "enr-m", cycleMonth: "2026-05-27", status: "approved", amount: 3000, currency: "PKR" },
        { enrollmentId: "enr-m", cycleMonth: "2026-06-27", status: "approved", amount: 3000, currency: "PKR" },
        { enrollmentId: "enr-m", cycleMonth: "2026-07-27", status: "pending", amount: 3000, currency: "PKR" },
        // 2026-08-27 has no row → owed
      ]
    );
    const m = d.enrollments[0].monthly!;
    expect(m.paidCount).toBe(2);
    expect(m.pendingCount).toBe(1);
    expect(m.owedCount).toBe(1);
    expect(d.totals[0]).toEqual({ currency: "PKR", paid: 6000, pending: 3000, owed: 3000 });
  });

  it("a full FA waiver makes every cycle waived with nothing owed", () => {
    const d = build([monthly({ faApprovedAmount: 0 })]);
    const m = d.enrollments[0].monthly!;
    expect(m.cycles.every((c) => c.state === "waived")).toBe(true);
    expect(d.totals[0].owed).toBe(0);
  });

  it("a non-billable method (manual_approval) waives every cycle", () => {
    const d = build([monthly({ paymentMethod: "manual_approval" })]);
    const m = d.enrollments[0].monthly!;
    expect(m.cycles.every((c) => c.state === "waived")).toBe(true);
    expect(d.totals[0].owed).toBe(0);
  });

  it("a not-yet-approved monthly enrollment shows an enrollment state and no cycles", () => {
    const d = build([monthly({ status: "pending" })]);
    const m = d.enrollments[0].monthly!;
    expect(m.enrollmentState).toBe("pending");
    expect(m.cycles).toHaveLength(0);
  });

  it("a pending FA request holds cycles in review rather than owed", () => {
    const d = build([monthly({ faRequested: true, faReviewedAt: null })]);
    const m = d.enrollments[0].monthly!;
    expect(m.cycles.every((c) => c.state === "pending")).toBe(true);
    expect(d.totals[0].owed).toBe(0);
    expect(d.totals[0].pending).toBe(12000);
  });
});

describe("buildFeeStatement — multi-currency", () => {
  it("keeps PKR and USD balances separate and never blends them", () => {
    const d = build([
      enrollment({ enrollmentId: "pk", paymentCurrency: "PKR", offeringPrice: 5000, paymentAmount: 5000 }),
      enrollment({
        enrollmentId: "us",
        feeType: "monthly",
        paymentCurrency: "USD",
        offeringPrice: 5000,
        offeringPriceUsd: 20,
        paymentAmount: 20,
      }),
    ]);
    expect(d.currencies).toEqual(["PKR", "USD"]);
    const pkr = d.totals.find((t) => t.currency === "PKR")!;
    const usd = d.totals.find((t) => t.currency === "USD")!;
    expect(pkr.paid).toBe(5000);
    expect(usd.owed).toBe(80); // 4 cycles × USD 20
  });
});

describe("buildFeeStatement — empty", () => {
  it("reports no activity when there are no enrollments", () => {
    const d = build([]);
    expect(d.hasActivity).toBe(false);
    expect(d.totals).toEqual([]);
  });
});

// ── Level 3: buildFeeRoster ────────────────────────────────────────────────
// The roster delegates every student's money math to buildFeeStatement, so
// these tests focus on what the roster adds: headline state, per-currency
// aggregation across students, and owed-first ordering.

function rosterStudent(
  studentId: string,
  studentName: string,
  over: Partial<FeeEnrollmentInput> = {}
): FeeRosterStudentInput {
  return {
    studentId,
    studentName,
    enrollment: enrollment({ enrollmentId: `enr-${studentId}`, ...over }),
  };
}

describe("buildFeeRoster — one-time course", () => {
  it("gives each student a headline state and totals paid across students", () => {
    const r = buildFeeRoster(
      {
        offeringId: "off-1",
        offeringTitle: "Qur'an Foundations",
        feeType: "one_time",
        students: [
          rosterStudent("a", "Aisha", { paymentAmount: 5000, status: "approved" }),
          rosterStudent("b", "Bilal", { paymentAmount: 5000, status: "pending" }),
          rosterStudent("c", "Cadet", { paymentAmount: 5000, status: "approved" }),
        ],
        monthlyPayments: [],
      },
      AS_OF
    );
    expect(r.totalStudents).toBe(3);
    const paid = r.rows.find((x) => x.studentId === "a")!;
    expect(paid.status).toBe("paid");
    const review = r.rows.find((x) => x.studentId === "b")!;
    expect(review.status).toBe("pending");
    // Per-currency total: 2 approved × 5000 paid, 1 pending × 5000.
    expect(r.totals).toEqual([{ currency: "PKR", paid: 10000, pending: 5000, owed: 0 }]);
  });

  it("sorts rows owed-first, then in-review, then the rest by name", () => {
    const r = buildFeeRoster(
      {
        offeringId: "off-1",
        offeringTitle: "T",
        feeType: "monthly",
        students: [
          // paid-up monthly (no owed cycles because it's non-billable/waived path handled elsewhere)
          rosterStudent("z", "Zaid", {
            feeType: "monthly",
            status: "approved",
            // Enrolled at the current cycle start → exactly one cycle, which he paid.
            createdAt: "2026-08-27T00:00:00Z",
            offeringPrice: 2000,
          }),
          rosterStudent("a", "Aisha", {
            feeType: "monthly",
            status: "approved",
            createdAt: "2026-05-01T00:00:00Z",
            offeringPrice: 2000,
          }),
        ],
        monthlyPayments: [
          // Zaid has paid his one cycle; Aisha owes several.
          {
            enrollmentId: "enr-z",
            cycleMonth: "2026-08-27",
            status: "approved", // an approved monthly_payment row = a paid cycle
            amount: 2000,
            currency: "PKR",
          },
        ],
      },
      AS_OF
    );
    // Aisha owes → she sorts before paid Zaid.
    expect(r.rows[0].studentId).toBe("a");
    expect(r.rows[0].status).toBe("owed");
    expect(r.rows[0].owedCount).toBeGreaterThan(0);
    expect(r.owedStudents).toBe(1);
  });

  it("keeps currencies separate when students pay in different currencies", () => {
    const r = buildFeeRoster(
      {
        offeringId: "off-1",
        offeringTitle: "T",
        feeType: "one_time",
        students: [
          rosterStudent("a", "Aisha", {
            paymentCurrency: "PKR",
            paymentAmount: 5000,
            status: "approved",
          }),
          rosterStudent("b", "Bilal", {
            paymentCurrency: "USD",
            paymentAmount: 60,
            status: "approved",
            offeringPriceUsd: 60,
          }),
        ],
        monthlyPayments: [],
      },
      AS_OF
    );
    expect(r.currencies.sort()).toEqual(["PKR", "USD"]);
    const pkr = r.totals.find((t) => t.currency === "PKR")!;
    const usd = r.totals.find((t) => t.currency === "USD")!;
    expect(pkr.paid).toBe(5000);
    expect(usd.paid).toBe(60);
  });

  it("reports zero students for an empty course", () => {
    const r = buildFeeRoster(
      {
        offeringId: "off-1",
        offeringTitle: "T",
        feeType: "one_time",
        students: [],
        monthlyPayments: [],
      },
      AS_OF
    );
    expect(r.totalStudents).toBe(0);
    expect(r.rows).toEqual([]);
    expect(r.totals).toEqual([]);
  });
});

// ── Level 1: summariseInstituteFees ─────────────────────────────────────────
// The overview never does its own money math — it folds rosters. These tests
// prove the fold: per-currency institute totals, counts, and the attention list.

function roster(over: Partial<FeeRosterData> = {}): FeeRosterData {
  return {
    offeringId: "off",
    offeringTitle: "Course",
    feeType: "one_time",
    rows: [],
    totals: [],
    currencies: [],
    totalStudents: 0,
    owedStudents: 0,
    pendingStudents: 0,
    ...over,
  };
}

describe("summariseInstituteFees", () => {
  it("adds up money per currency across courses, never blending", () => {
    const o = summariseInstituteFees([
      roster({
        offeringId: "a",
        totals: [
          { currency: "PKR", paid: 5000, pending: 0, owed: 2000 },
          { currency: "USD", paid: 60, pending: 0, owed: 0 },
        ],
        totalStudents: 3,
        owedStudents: 1,
      }),
      roster({
        offeringId: "b",
        totals: [{ currency: "PKR", paid: 3000, pending: 1000, owed: 0 }],
        totalStudents: 2,
        pendingStudents: 1,
      }),
    ]);
    const pkr = o.totals.find((t) => t.currency === "PKR")!;
    const usd = o.totals.find((t) => t.currency === "USD")!;
    expect(pkr).toEqual({ currency: "PKR", paid: 8000, pending: 1000, owed: 2000 });
    expect(usd).toEqual({ currency: "USD", paid: 60, pending: 0, owed: 0 });
    expect(o.currencies).toEqual(["PKR", "USD"]); // PKR before USD
  });

  it("counts courses, enrolments, and who needs chasing", () => {
    const o = summariseInstituteFees([
      roster({ offeringId: "a", totalStudents: 3, owedStudents: 2, pendingStudents: 0 }),
      roster({ offeringId: "b", totalStudents: 4, owedStudents: 0, pendingStudents: 1 }),
      roster({ offeringId: "c", totalStudents: 1, owedStudents: 0, pendingStudents: 0 }),
    ]);
    expect(o.courseCount).toBe(3);
    expect(o.enrollmentCount).toBe(8);
    expect(o.studentsOwing).toBe(2);
    expect(o.studentsInReview).toBe(1);
    expect(o.coursesOwing).toBe(1); // only course "a" has anyone owing
  });

  it("lists only courses with owing or in-review students in attention", () => {
    const o = summariseInstituteFees([
      roster({
        offeringId: "a",
        offeringTitle: "Owing course",
        owedStudents: 2,
        totals: [{ currency: "PKR", paid: 0, pending: 0, owed: 4000 }],
      }),
      roster({ offeringId: "b", offeringTitle: "Clean course", totalStudents: 5 }),
    ]);
    expect(o.attention.map((c) => c.offeringId)).toEqual(["a"]);
    expect(o.attention[0].owedTotals).toEqual([
      { currency: "PKR", paid: 0, pending: 0, owed: 4000 },
    ]);
  });

  it("is empty and safe when there are no rosters", () => {
    const o = summariseInstituteFees([]);
    expect(o.courseCount).toBe(0);
    expect(o.totals).toEqual([]);
    expect(o.attention).toEqual([]);
    expect(o.studentsOwing).toBe(0);
  });
});
