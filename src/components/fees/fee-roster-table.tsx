/**
 * FeeRosterTable — Level 3. One course's enrolled students, each resolved to a
 * headline fee state, sorted so whoever needs chasing sits on top. Purely
 * presentational: hand it a FeeRosterData. Each student's name links to their
 * full statement (Level 4) inside the billing area, so admins and treasurers
 * can drill macro → micro without leaving the gate.
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatMonthlyAmount } from "@/lib/monthly-payments";
import { FeeStatePill } from "@/components/fees/fee-state-pill";
import type { FeeRosterData, FeeRosterRow } from "@/lib/fees";

const ROSTER_LABEL: Partial<Record<FeeRosterRow["status"], string>> = {
  // The roster reads "Up to date" where a single statement reads "Paid".
  paid: "Up to date",
};

function AmountCell({ row }: { row: FeeRosterRow }) {
  if (row.feeType === "monthly") {
    const bits: React.ReactNode[] = [];
    if (row.owedCount > 0)
      bits.push(
        <span key="o" className="font-semibold text-red-700 dark:text-red-300">
          {row.owedCount} owed · {formatMonthlyAmount(row.owedAmount, row.currency)}
        </span>
      );
    if (row.pendingCount > 0)
      bits.push(
        <span key="p" className="text-amber-700 dark:text-amber-300">
          {row.pendingCount} in review
        </span>
      );
    if (bits.length === 0)
      return <span className="text-muted-foreground">No dues</span>;
    return (
      <span className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
        {bits}
      </span>
    );
  }
  // one-time
  if (row.status === "owed")
    return (
      <span className="font-semibold text-red-700 dark:text-red-300">
        {formatMonthlyAmount(row.owedAmount, row.currency)}
      </span>
    );
  if (row.status === "pending")
    return (
      <span className="text-amber-700 dark:text-amber-300">
        {formatMonthlyAmount(row.pendingAmount, row.currency)} in review
      </span>
    );
  if (row.status === "paid")
    return (
      <span className="text-muted-foreground">
        {formatMonthlyAmount(row.paidAmount, row.currency)} paid
      </span>
    );
  return <span className="text-muted-foreground">—</span>;
}

export function FeeRosterTable({ data }: { data: FeeRosterData }) {
  if (data.totalStudents === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        No students enrolled on this course yet.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Student</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Balance</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                key={row.enrollmentId}
                className="border-b border-border/60 last:border-0 hover:bg-accent/40"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/admin/payments/student/${row.studentId}`}
                    className="font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {row.studentName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <FeeStatePill
                    state={row.status}
                    label={ROSTER_LABEL[row.status]}
                  />
                </td>
                <td className="px-4 py-3">
                  <AmountCell row={row} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/dashboard/admin/payments/student/${row.studentId}`}
                    className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    aria-label={`Open ${row.studentName}'s fee statement`}
                  >
                    Statement
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
