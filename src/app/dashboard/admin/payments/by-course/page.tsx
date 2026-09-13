/**
 * By Course (Level 3 index) — one card per offering, so a treasurer or admin
 * can see at a glance which courses have money outstanding and open the roster
 * for the worst offenders first. Billing-gated (admin + treasurer) by the
 * admin layout; we double-check the role here as the other payments pages do.
 * Read-only: it only reads the fee engine, never writes.
 */
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchFeeRosterIndex } from "@/lib/fees";
import { formatMonthlyAmount } from "@/lib/monthly-payments";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Table2, Users, AlertCircle, Hourglass, ChevronRight } from "lucide-react";

export default async function ByCoursePage() {
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

  const rosters = await fetchFeeRosterIndex(supabase);

  return (
    <div>
      <PageHeader
        eyebrow="Fees"
        title="By course"
        subtitle="Every course, and who still owes on it. Sorted so the courses needing the most chasing come first."
        icon={Table2}
      />

      {rosters.length === 0 ? (
        <EmptyState
          icon={Table2}
          title="No courses with enrolled students yet"
          description="Once students enrol on a course, it will show up here with its fee status."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rosters.map((r) => {
            const owedTotals = r.totals.filter((t) => t.owed > 0);
            return (
              <li key={r.offeringId}>
                <Link
                  href={`/dashboard/admin/payments/by-course/${r.offeringId}`}
                  className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition hover:border-primary/50 hover:bg-accent/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-heading text-base font-semibold text-foreground">
                      {r.offeringTitle}
                    </h3>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {r.totalStudents} enrolled
                    </span>
                    {r.owedStudents > 0 && (
                      <span className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-300">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {r.owedStudents} owing
                      </span>
                    )}
                    {r.pendingStudents > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                        <Hourglass className="h-3.5 w-3.5" />
                        {r.pendingStudents} in review
                      </span>
                    )}
                  </div>

                  {owedTotals.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {owedTotals.map((t) => (
                        <span
                          key={t.currency}
                          className="rounded-md bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300"
                        >
                          {formatMonthlyAmount(t.owed, t.currency)} owed
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
