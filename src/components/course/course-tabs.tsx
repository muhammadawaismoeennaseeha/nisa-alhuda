"use client";

import { cn } from "@/lib/utils";

/**
 * The one course-page tab control.
 *
 * Ported from Naseeha's CourseTabs. Below sm the tabs become a native picker:
 * four of them already crowd a phone, and a horizontal scroller hides the
 * off-screen ones with no affordance at all. The OS control shows every section
 * at once and is a full finger tall.
 *
 * Only one of the two renderings is ever displayed — the other is
 * `display:none` — so a `getByRole('tab')` selector still resolves to a single
 * element.
 *
 * The phone picker's id is derived from the label rather than fixed, so one
 * strip can sit inside another without two `id="course-tab"` elements pointing
 * the outer label at the inner control.
 *
 * This is deliberately not shadcn's `ui/tabs`: that renders a pill-style
 * `TabsList` with no mobile fallback, and the tab strip is the part of the
 * Naseeha structure being ported.
 */

export interface CourseTab<K extends string> {
  key: K;
  label: string;
  icon: React.ElementType;
}

export function CourseTabs<K extends string>({
  tabs,
  active,
  onChange,
  label = "Course section",
}: {
  tabs: readonly CourseTab<K>[];
  active: K;
  onChange: (key: K) => void;
  label?: string;
}) {
  const selectId = `course-tab-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div>
      <div className="sm:hidden">
        <label htmlFor={selectId} className="sr-only">
          {label}
        </label>
        <select
          id={selectId}
          value={active}
          onChange={(e) => onChange(e.target.value as K)}
          className="w-full rounded-[10px] border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground focus:border-ring focus:outline-none"
        >
          {tabs.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div
        role="tablist"
        aria-label={label}
        className="hidden border-b border-border sm:block"
      >
        <div className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = active === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onChange(t.key)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 border-b-2 px-[15px] py-[11px] text-sm font-semibold whitespace-nowrap transition-colors",
                  isActive
                    ? "border-rose-500 text-rose-700 dark:border-rose-400 dark:text-rose-300"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
