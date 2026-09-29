/**
 * Fees overview (Module 6, Level 1) — the top of the ladder. One institute-wide
 * rollup: how much has been collected, how much is in review, how much is owed,
 * kept separate by currency. Beneath it, the courses that need chasing link
 * straight into their roster (Level 3). Billing-gated (admin + treasurer);
 * read-only — it folds the same course rosters, never its own money math.
 */
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchInstituteFeeOverview } from "@/lib/fees";
import { formatMonthlyAmount } from "@/lib/monthly-payments";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  BarChart3,
  Users,
  BookOpen,
  AlertCircle,
  Hourglass,
  ChevronRight,
} from "lucide-react";

export default async function FeesOverviewPage() {
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

  const overview = await fetchInstituteFeeOverview(supabase);
  const hasActivity = overview.courseCount > 0 && overview.totals.length > 0;

  return (
    <div>
      <PageHeader
        eyebrow="Fees"
        title="Overview"
        subtitle="The whole institute at a glance — collected, in review, and outstanding, kept separate by currency."
        icon={BarChart3}
      />

      {!hasActivity ? (
        <EmptyState
          icon={BarChart3}
          title="No fee activity yet"
          description="Once students enrol and pay, the institute rollup will appear here."
        />
      ) : (
        <div className="space-y-6">
          {/* Per-currency money cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.totals.map((t) => (
              <div
                key={t.currency}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t.currency}
                  </span>
                  {t.owed > 0 && (
                    <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300">
                      {formatMonthlyAmount(t.owed, t.currency)} owed
                    </span>
                  )}
                </div>
                <p className="mt-2 font-heading text-2xl font-bold text-foreground">
                  {formatMonthlyAmount(t.paid, t.currency)}
                </p>
                <p className="text-xs text-muted-foreground">collected</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-amber-700 dark:text-amber-300">
                    {formatMonthlyAmount(t.pending, t.currency)} in review
                  </span>
                  <span
                    className={
                      t.owed > 0
                        ? "font-medium text-red-700 dark:text-red-300"
                        : "text-muted-foreground"
                    }
                  >
                    {formatMonthlyAmount(t.owed, t.currency)} outstanding
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Count strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <CountTile icon={BookOpen} label="Courses" value={overview.courseCount} />
            <CountTile icon={Users} label="Enrolments" value={overview.enrollmentCount} />
            <CountTile
              icon={AlertCircle}
              label="Students owing"
              value={overview.studentsOwing}
              tone={overview.studentsOwing > 0 ? "red" : undefined}
            />
            <CountTile
              icon={Hourglass}
              label="In review"
              value={overview.studentsInReview}
              tone={overview.studentsInReview > 0 ? "amber" : undefined}
            />
          </div>

          {/* Courses needing attention */}
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-heading text-base font-semibold text-foreground">
                Needs attention
              </h2>
              <Link
                href="/dashboard/admin/payments/by-course"
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                All courses →
              </Link>
            </div>

            {overview.attention.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                Every course is up to date — nothing owing and nothing in review.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {overview.attention.map((c) => (
                  <li key={c.offeringId}>
                    <Link
                      href={`/dashboard/admin/payments/by-course/${c.offeringId}`}
                      className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">
                          {c.offeringTitle}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                          {c.owedStudents > 0 && (
                            <span className="font-medium text-red-700 dark:text-red-300">
                              {c.owedStudents} owing
                            </span>
                          )}
                          {c.pendingStudents > 0 && (
                            <span className="text-amber-700 dark:text-amber-300">
                              {c.pendingStudents} in review
                            </span>
                          )}
                          <span className="text-muted-foreground">
                            {c.totalStudents} enrolled
                          </span>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        {c.owedTotals.map((t) => (
                          <span
                            key={t.currency}
                            className="rounded-md bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300"
                          >
                            {formatMonthlyAmount(t.owed, t.currency)}
                          </span>
                        ))}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function CountTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "red" | "amber";
}) {
  const valueClass =
    tone === "red"
      ? "text-red-700 dark:text-red-300"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-300"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className={`mt-1 font-heading text-xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}
