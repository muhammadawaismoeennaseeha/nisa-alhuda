/**
 * The one course-page header.
 *
 * Restyled to the signed-off courses mockup: back link, a chip row carrying the
 * mono course code and uppercase status badges, the course name in the heading
 * face, a muted context line, the description, and the action buttons pinned
 * right. Built on Nisa's own tokens via `course-surface` — none of the mockup's
 * scaffolding colours are hardcoded here.
 *
 * Actions sit beside the title from sm up and drop below it on a phone, where a
 * row of buttons next to a wrapping course name has nowhere to go.
 */
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  badgeBase,
  courseCard,
  pillTones,
  type PillTone,
} from "./course-surface";

export interface CourseBadge {
  label: string;
  tone: PillTone;
}

export function CoursePageHeader({
  backHref,
  backLabel,
  code,
  name,
  context,
  description,
  badges = [],
  actions,
}: {
  backHref: string;
  backLabel: string;
  /** Short identifier shown in mono before the badges — e.g. the slug. */
  code?: string | null;
  name: string;
  /** Secondary line under the title, e.g. "Course · Online · 12 lessons". */
  context?: string;
  description?: string | null;
  badges?: CourseBadge[];
  actions?: React.ReactNode;
}) {
  return (
    <div>
      <Link
        href={backHref}
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-rose-700 dark:hover:text-rose-300"
      >
        <ChevronLeft className="h-4 w-4" />
        {backLabel}
      </Link>

      <div className={cn(courseCard, "p-5 sm:px-6 sm:py-[22px]")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {(code || badges.length > 0) && (
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                {code && (
                  <span className="rounded-md bg-rose-50 px-2 py-[3px] font-mono text-[11px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">
                    {code}
                  </span>
                )}
                {badges.map((b) => (
                  <span
                    key={b.label}
                    className={cn(badgeBase, pillTones[b.tone])}
                  >
                    {b.label}
                  </span>
                ))}
              </div>
            )}

            <h1 className="font-heading text-2xl leading-[1.15] font-bold tracking-[-0.01em] break-words sm:text-[27px]">
              {name}
            </h1>

            {context && (
              <p className="mt-1.5 text-[13.5px] text-muted-foreground">
                {context}
              </p>
            )}
            {description && (
              <p className="mt-3 max-w-[60ch] text-sm text-plum-body dark:text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
