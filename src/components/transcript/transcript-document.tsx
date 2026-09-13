/**
 * TranscriptDocument — the printable academic transcript, shared by the
 * student's live view, the staff live view, and an issued snapshot. Purely
 * presentational and server-safe: hand it a TranscriptData (live or thawed
 * from a snapshot) plus optional issuance metadata.
 *
 * Grade pills reuse gradeBadgeClasses so a transcript is coloured exactly like
 * the gradebook it came from. The `print:` utilities collapse the dashboard
 * chrome to a clean sheet when the reader hits Print / Save as PDF.
 */
import { gradeBadgeClasses } from "@/lib/utils/grades";
import type { TranscriptData } from "@/lib/transcripts";

interface IssuedMeta {
  serial: string;
  issuedAt: string;
  issuedByName?: string | null;
  notes?: string | null;
}

function fmtPct(pct: number | null): string {
  return pct === null ? "—" : `${pct}%`;
}

function GradePill({
  pct,
  letter,
  size = "sm",
}: {
  pct: number | null;
  letter: string | null;
  size?: "sm" | "lg";
}) {
  const cls = gradeBadgeClasses(pct);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${cls} ${
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"
      }`}
    >
      <span>{fmtPct(pct)}</span>
      {letter && <span className="opacity-70">·</span>}
      {letter && <span>{letter}</span>}
    </span>
  );
}

export function TranscriptDocument({
  data,
  issued,
}: {
  data: TranscriptData;
  issued?: IssuedMeta;
}) {
  const issuedDate = issued
    ? new Date(issued.issuedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div
      id="transcript-sheet"
      className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-8"
    >
      {/* Letterhead */}
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
            Nisa Al-Huda · Women of Guidance
          </p>
          <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight">
            Academic Transcript
          </h1>
          <p className="mt-2 text-lg font-semibold">{data.studentName}</p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          {issued ? (
            <>
              <span className="inline-flex items-center rounded-full border border-sage-200 bg-sage-50 px-2.5 py-0.5 text-xs font-semibold text-sage-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                Official · Issued
              </span>
              <p className="mt-2 font-mono text-sm font-semibold">{issued.serial}</p>
              <p className="text-xs text-muted-foreground">Issued {issuedDate}</p>
              {issued.issuedByName && (
                <p className="text-xs text-muted-foreground">
                  by {issued.issuedByName}
                </p>
              )}
            </>
          ) : (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Live preview · not yet issued
            </span>
          )}
        </div>
      </header>

      {/* Cumulative summary */}
      <section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Cumulative result
          </p>
          <p className="text-xs text-muted-foreground">
            Simple average of {data.gradedSubjectCount} graded{" "}
            {data.gradedSubjectCount === 1 ? "subject" : "subjects"}
            {data.totalSubjectCount > data.gradedSubjectCount &&
              ` (of ${data.totalSubjectCount})`}
          </p>
        </div>
        <GradePill pct={data.cumulativePct} letter={data.cumulativeLetter} size="lg" />
      </section>

      {/* Per-offering breakdown */}
      {data.offerings.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No enrolled courses to report yet.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {data.offerings.map((off) => (
            <section key={off.offeringId}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-1.5">
                <h2 className="font-heading text-base font-bold">{off.title}</h2>
                <GradePill pct={off.pct} letter={off.letter} />
              </div>
              <div className="space-y-3">
                {off.subjects.map((s) => (
                  <div key={s.subjectId} className="pl-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{s.title}</h3>
                      <GradePill pct={s.pct} letter={s.letter} />
                    </div>
                    {s.items.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {s.items.map((it, i) => (
                          <li
                            key={i}
                            className="flex items-baseline justify-between gap-3 text-xs"
                          >
                            <span className="min-w-0 truncate text-muted-foreground">
                              <span className="text-foreground">{it.label}</span>
                              <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                                {it.typeLabel}
                              </span>
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {it.detail}
                              {it.percentage !== null && (
                                <span className="ml-1.5 font-medium text-foreground">
                                  {it.percentage}%
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {issued?.notes && (
        <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Note: </span>
          {issued.notes}
        </p>
      )}

      <footer className="mt-6 border-t border-border pt-3 text-[11px] text-muted-foreground">
        {issued
          ? `Official record ${issued.serial}. Figures are frozen as of the issue date and do not change with later grade edits.`
          : "This is a live preview of the current gradebook. Issue an official transcript to freeze these figures."}
      </footer>
    </div>
  );
}
