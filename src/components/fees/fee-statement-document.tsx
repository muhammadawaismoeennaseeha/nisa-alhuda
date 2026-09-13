/**
 * FeeStatementDocument — the printable, currency-aware fee statement shared by
 * the student's own view and the staff view. Purely presentational and
 * server-safe: hand it a FeeStatementData.
 *
 * It shows the macro's micro: per-currency totals up top (never blended), then
 * every enrollment — one-time as a single settled/owed line, monthly as a full
 * cycle ledger. Amounts are formatted with the shared money SSOT so a statement
 * can never disagree with the reminder cron or the payment-block gate.
 *
 * The `print:` utilities + the `#fee-statement-sheet` id (see globals.css)
 * collapse the dashboard chrome to a clean sheet on Print / Save as PDF.
 */
import { formatMonthlyAmount } from "@/lib/monthly-payments";
import type {
  FeeStatementData,
  FeeEnrollment,
  CurrencyTotal,
} from "@/lib/fees";
import { FeeStatePill } from "@/components/fees/fee-state-pill";

function TypeBadge({ label }: { label: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
  );
}

/** Per-currency totals card. Owed is the actionable figure, so it leads red. */
function TotalsCard({ total }: { total: CurrencyTotal }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">
        {total.currency}
      </p>
      <dl className="mt-2 space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-muted-foreground">Paid</dt>
          <dd className="tabular-nums text-sm font-semibold">
            {formatMonthlyAmount(total.paid, total.currency)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-muted-foreground">In review</dt>
          <dd className="tabular-nums text-sm font-medium text-amber-700 dark:text-amber-300">
            {formatMonthlyAmount(total.pending, total.currency)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border/70 pt-1.5">
          <dt className="text-xs font-medium text-foreground">Owed now</dt>
          <dd
            className={`tabular-nums text-base font-bold ${
              total.owed > 0
                ? "text-red-700 dark:text-red-300"
                : "text-sage-700 dark:text-emerald-300"
            }`}
          >
            {formatMonthlyAmount(total.owed, total.currency)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** FA reduction as "PKR 15,000 → PKR 10,000" with the full price struck out. */
function FaReduction({
  full,
  effective,
  currency,
}: {
  full: number;
  effective: number;
  currency: string;
}) {
  return (
    <span className="text-xs text-muted-foreground">
      <span className="line-through decoration-1">
        {formatMonthlyAmount(full, currency)}
      </span>
      <span className="mx-1">→</span>
      <span className="font-semibold text-primary">
        {formatMonthlyAmount(effective, currency)}
      </span>
      <span className="ml-1.5 rounded bg-primary/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-primary">
        Financial assistance
      </span>
    </span>
  );
}

function OneTimeLine({ e }: { e: FeeEnrollment }) {
  const o = e.oneTime!;
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{e.title}</h3>
          <TypeBadge label="One-time" />
        </div>
        <p className="mt-0.5 text-xs">
          {o.hasFaReduction ? (
            <FaReduction
              full={o.fullAmount}
              effective={o.effectiveAmount}
              currency={e.currency}
            />
          ) : o.state === "no_fee" ? (
            <span className="text-muted-foreground">No fee for this course</span>
          ) : o.state === "waived" ? (
            <span className="text-muted-foreground">Fee waived</span>
          ) : (
            <span className="tabular-nums text-muted-foreground">
              {formatMonthlyAmount(o.effectiveAmount, e.currency)}
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {o.state === "paid" && o.paidAmount > 0 && (
          <span className="tabular-nums text-xs text-muted-foreground">
            {formatMonthlyAmount(o.paidAmount, e.currency)}
          </span>
        )}
        <FeeStatePill state={o.state} />
      </div>
    </div>
  );
}

function MonthlyBlock({ e }: { e: FeeEnrollment }) {
  const m = e.monthly!;
  return (
    <div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{e.title}</h3>
            <TypeBadge label="Monthly" />
          </div>
          <p className="mt-0.5 text-xs">
            {m.hasFaReduction ? (
              <FaReduction
                full={m.fullAmount}
                effective={m.monthlyAmount}
                currency={e.currency}
              />
            ) : (
              <span className="tabular-nums text-muted-foreground">
                {formatMonthlyAmount(m.monthlyAmount, e.currency)} / month
              </span>
            )}
          </p>
        </div>
        {m.enrollmentState ? (
          <FeeStatePill state={m.enrollmentState} />
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {m.paidCount > 0 && <span>{m.paidCount} paid</span>}
            {m.pendingCount > 0 && (
              <span className="text-amber-700 dark:text-amber-300">
                {m.pendingCount} in review
              </span>
            )}
            {m.owedCount > 0 && (
              <span className="font-semibold text-red-700 dark:text-red-300">
                {m.owedCount} owed
              </span>
            )}
          </div>
        )}
      </div>

      {m.enrollmentState === null && m.cycles.length > 0 && (
        <ul className="mt-2 space-y-1">
          {m.cycles.map((c) => (
            <li
              key={c.cycleKey}
              className={`flex items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5 text-xs ${
                c.isCurrent
                  ? "border-primary/30 bg-primary/5"
                  : "border-transparent"
              }`}
            >
              <span className="min-w-0">
                <span className="font-medium text-foreground">{c.label}</span>
                {c.isCurrent && (
                  <span className="ml-1.5 rounded bg-primary/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-primary">
                    Current
                  </span>
                )}
                <span className="ml-1.5 hidden text-muted-foreground sm:inline">
                  {c.period}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-muted-foreground">
                  {formatMonthlyAmount(c.amount, c.currency)}
                </span>
                <FeeStatePill state={c.state} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {m.enrollmentState === null && m.cycles.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          No billable months yet — the first cycle hasn&apos;t started.
        </p>
      )}
    </div>
  );
}

export function FeeStatementDocument({ data }: { data: FeeStatementData }) {
  const asOfLabel = (() => {
    const [y, m, d] = data.asOf.split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString(
      "en-GB",
      { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
    );
  })();

  return (
    <div
      id="fee-statement-sheet"
      className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-8"
    >
      {/* Letterhead */}
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
            Nisa Al-Huda · Women of Guidance
          </p>
          <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight">
            Fee Statement
          </h1>
          <p className="mt-2 text-lg font-semibold">{data.studentName}</p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            Live statement
          </span>
          <p className="mt-2 text-xs text-muted-foreground">As of {asOfLabel}</p>
        </div>
      </header>

      {!data.hasActivity ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No enrolled courses to bill yet.
        </p>
      ) : (
        <>
          {/* Per-currency totals — never blended */}
          <section className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Balance by currency
              </p>
              {data.currencies.length > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  Currencies are never blended — each is settled on its own.
                </p>
              )}
            </div>
            <div
              className={`grid gap-3 ${
                data.totals.length > 1
                  ? "sm:grid-cols-2 lg:grid-cols-3"
                  : "sm:grid-cols-1"
              }`}
            >
              {data.totals.map((t) => (
                <TotalsCard key={t.currency} total={t} />
              ))}
            </div>
          </section>

          {/* Per-enrollment breakdown */}
          <div className="mt-6 space-y-5">
            {data.enrollments.map((e) => (
              <section
                key={e.enrollmentId}
                className="rounded-xl border border-border/70 p-4"
              >
                {e.feeType === "one_time" ? (
                  <OneTimeLine e={e} />
                ) : (
                  <MonthlyBlock e={e} />
                )}
              </section>
            ))}
          </div>
        </>
      )}

      <footer className="mt-6 border-t border-border pt-3 text-[11px] text-muted-foreground">
        This is a live statement built from your current enrollments and
        receipts. Figures update as payments are reviewed. Amounts in different
        currencies are shown and settled separately.
      </footer>
    </div>
  );
}
