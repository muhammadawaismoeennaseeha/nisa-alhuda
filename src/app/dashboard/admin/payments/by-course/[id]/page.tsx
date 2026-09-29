/**
 * Per-course roster (Level 3 detail) — one offering's enrolled students, each
 * with a headline fee state, owed/in-review sorted to the top. The "who owes"
 * layer between the institute overview and the individual statement. Every
 * student name drills into their full statement (Level 4) inside the billing
 * gate. Billing-gated (admin + treasurer); read-only.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchFeeRosterForOffering } from "@/lib/fees";
import { formatMonthlyAmount } from "@/lib/monthly-payments";
import { PageHeader } from "@/components/dashboard/page-header";
import { FeeRosterTable } from "@/components/fees/fee-roster-table";
import { ArrowLeft, Table2, Users } from "lucide-react";

export default async function CourseRosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id)
    .single();

  if (profile?.role !== "admin" && profile?.role !== "treasurer") {
    return (
      <div className="py-20 text-center">
        <p className="font-medium text-destructive">Access denied.</p>
      </div>
    );
  }

  const roster = await fetchFeeRosterForOffering(supabase, id);
  if (!roster) notFound();

  const owedTotals = roster.totals.filter((t) => t.owed > 0);

  return (
    <div>
      <Link
        href="/dashboard/admin/payments/by-course"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All courses
      </Link>

      <PageHeader
        eyebrow="Fees · by course"
        title={roster.offeringTitle}
        subtitle={
          roster.feeType === "monthly"
            ? "Monthly course — each student's outstanding cycles are summarised below."
            : "One-time course — each student's payment status is summarised below."
        }
        icon={Table2}
      />

      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-4 w-4" />
          {roster.totalStudents} enrolled
        </span>
        {roster.owedStudents > 0 && (
          <span className="font-medium text-red-700 dark:text-red-300">
            {roster.owedStudents} owing
          </span>
        )}
        {roster.pendingStudents > 0 && (
          <span className="text-amber-700 dark:text-amber-300">
            {roster.pendingStudents} in review
          </span>
        )}
        {owedTotals.map((t) => (
          <span
            key={t.currency}
            className="rounded-md bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300"
          >
            {formatMonthlyAmount(t.owed, t.currency)} owed
          </span>
        ))}
      </div>

      <FeeRosterTable data={roster} />
    </div>
  );
}
