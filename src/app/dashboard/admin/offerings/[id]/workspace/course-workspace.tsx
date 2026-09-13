"use client";

/**
 * The tabbed shell for the admin course workspace, rendered to the signed-off
 * courses mockup.
 *
 * Tab state is client-side rather than a route segment: all four tabs render
 * from the same queries the page already ran, so making them separate routes
 * would re-fetch the whole course to move between them. The Overview's nav
 * cards drive the same state, which is the point of the layout — Overview is a
 * map of the page, not a separate destination.
 *
 * Overview, People and Schedule are read-only projections of the page's
 * queries. Course Structure edits in place (`CourseStructureEditor`); its
 * writes go through `@/lib/course-structure`, the same module the instructor
 * subject screen saves through. The per-lesson recording flag stays a plain
 * label with no link and no control — changing a `recording_url` is a
 * deliberate unlock inside the edit dialog and nowhere else.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clock,
  Inbox,
  LayoutGrid,
  ListTree,
  Users,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CoursePageHeader,
  type CourseBadge,
} from "@/components/course/course-page-header";
import { CourseTabs, type CourseTab } from "@/components/course/course-tabs";
import { LinkCard, MetricCard, NavCard } from "@/components/course/course-cards";
import {
  CourseRoster,
  type RosterEnrollment,
} from "@/components/course/course-roster";
import {
  CourseStructureEditor,
  type SubjectWithInstructor,
} from "@/components/course/course-structure-editor";
import type { InstructorOption } from "@/components/course/subject-dialog";
import {
  courseButton,
  courseCard,
} from "@/components/course/course-surface";
import { scheduleDisplayLabel } from "@/lib/recurring-schedule";
import type { Lesson, Offering } from "@/lib/types/database";
import { CourseHeaderActions } from "./course-header-actions";

type TabKey = "overview" | "people" | "structure" | "schedule";

const TABS: readonly CourseTab<TabKey>[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "people", label: "People", icon: Users },
  { key: "structure", label: "Course Structure", icon: ListTree },
  { key: "schedule", label: "Schedule", icon: CalendarClock },
];

const MODE_LABELS: Record<Offering["mode"], string> = {
  online: "Online",
  onsite: "On-site",
  hybrid: "Hybrid",
};

// Matches the labels on the offerings list. `constants.OFFERING_TYPES` is
// keyed by the uppercase name, not the stored value, so it can't index a row.
const TYPE_LABELS: Record<Offering["type"], string> = {
  program: "Program",
  course: "Course",
  workshop: "Workshop",
  class: "Class",
};

const STATUS_LABELS: Record<Offering["status"], string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

const DAY_CHIPS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-PK", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-PK", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A panel heading — the mockup's `.sectitle`. */
function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "font-heading flex items-center gap-2 text-[13px] font-bold",
        className
      )}
    >
      {children}
    </h3>
  );
}

export function CourseWorkspace({
  offering,
  instructorName,
  subjects,
  lessons,
  roster,
  pendingCount = 0,
  resourceCounts = {},
  instructors = [],
}: {
  offering: Offering;
  instructorName: string | null;
  subjects: SubjectWithInstructor[];
  lessons: Lesson[];
  roster: RosterEnrollment[];
  /** Enrollments on this course still awaiting a decision. */
  pendingCount?: number;
  /** lesson id → number of attached resources. */
  resourceCounts?: Record<string, number>;
  /** Candidates for a subject's required `instructor_id`. */
  instructors?: InstructorOption[];
}) {
  const [active, setActive] = useState<TabKey>("overview");

  const recordingCount = lessons.filter(
    (l) => l.recording_url && l.recording_url.trim() !== ""
  ).length;
  const publishedLessons = lessons.filter((l) => l.is_published).length;

  const badges: CourseBadge[] = [
    {
      label: STATUS_LABELS[offering.status] ?? offering.status,
      tone:
        offering.status === "published"
          ? "success"
          : offering.status === "draft"
            ? "warning"
            : "muted",
    },
    {
      label: TYPE_LABELS[offering.type] ?? offering.type,
      tone: "brand",
    },
  ];
  if (offering.is_ongoing) badges.push({ label: "On-going", tone: "warning" });
  if (offering.admission_closed)
    badges.push({ label: "Admission closed", tone: "muted" });

  const context = [
    MODE_LABELS[offering.mode],
    instructorName,
    plural(subjects.length, "subject"),
    plural(lessons.length, "lesson"),
  ]
    .filter(Boolean)
    .join(" · ");

  const scheduleSummary = useMemo(
    () => weeklySummary(subjects) ?? "No weekly slot set",
    [subjects]
  );

  return (
    <div className="space-y-5">
      <CoursePageHeader
        backHref="/dashboard/admin/offerings"
        backLabel="All courses"
        code={offering.slug}
        name={offering.title}
        context={context}
        description={offering.short_description}
        badges={badges}
        actions={<CourseHeaderActions offering={offering} />}
      />

      <CourseTabs tabs={TABS} active={active} onChange={setActive} />

      {active === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 min-[760px]:grid-cols-3">
            <MetricCard
              icon={Users}
              label="Enrolled students"
              value={roster.length}
            />
            <MetricCard
              icon={BookOpen}
              label={`Lessons · ${publishedLessons} published`}
              value={lessons.length}
              tint="success"
            />
            <MetricCard
              icon={Video}
              label="Lessons with a recording"
              value={recordingCount}
              tint="warning"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 min-[760px]:grid-cols-4">
            <NavCard
              icon={Users}
              title="People"
              detail={`${roster.length} enrolled`}
              onClick={() => setActive("people")}
            />
            <NavCard
              icon={ListTree}
              title="Course Structure"
              detail={`${plural(subjects.length, "subject")} · ${plural(lessons.length, "lesson")}`}
              onClick={() => setActive("structure")}
            />
            <NavCard
              icon={CalendarClock}
              title="Schedule"
              detail={scheduleSummary}
              onClick={() => setActive("schedule")}
            />
            <LinkCard
              icon={Inbox}
              title="Enrolment requests"
              detail={
                pendingCount === 1
                  ? "1 awaiting approval"
                  : `${pendingCount} awaiting approval`
              }
              href={`/dashboard/admin/offerings/${offering.id}/students`}
            />
          </div>
        </div>
      )}

      {active === "people" && (
        <CourseRoster
          rows={roster}
          addHref={`/dashboard/admin/offerings/${offering.id}/students`}
        />
      )}

      {active === "structure" && (
        <CourseStructureEditor
          offeringId={offering.id}
          subjects={subjects}
          lessons={lessons}
          resourceCounts={resourceCounts}
          instructors={instructors}
          defaultInstructorId={offering.instructor_id}
        />
      )}

      {active === "schedule" && (
        <CourseSchedule
          offering={offering}
          subjects={subjects}
          lessons={lessons}
        />
      )}
    </div>
  );
}

/* ── Schedule ─────────────────────────────────────────────────────────── */

function minutesToLabel(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** "6:00 PM – 7:00 PM" for a subject's weekly slot, or null when unset. */
function slotRange(s: SubjectWithInstructor): string | null {
  if (!s.recurring_start_time) return null;
  const [h, m] = s.recurring_start_time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const start = h * 60 + m;
  const end = start + (s.recurring_duration_minutes ?? 60);
  return `${minutesToLabel(start)} – ${minutesToLabel(end)}`;
}

/**
 * The one-line schedule summary for the Overview nav card: the weekday
 * initials plus the time, when every subject shares a slot.
 */
function weeklySummary(subjects: SubjectWithInstructor[]): string | null {
  const days = [
    ...new Set(
      subjects
        .map((s) => s.recurring_day_of_week)
        .filter((d): d is number => d != null)
    ),
  ].sort((a, b) => a - b);
  if (days.length === 0) return null;

  const ranges = [
    ...new Set(subjects.map(slotRange).filter((r): r is string => r != null)),
  ];
  const dayLabel = days.map((d) => DAY_CHIPS[d]).join(", ");
  return ranges.length === 1 ? `${dayLabel} · ${ranges[0]}` : dayLabel;
}

/**
 * Schedule reads what Nisa already stores: the course start/end window, each
 * subject's weekly recurring slot, and the dated lessons. Nisa has no
 * course-level weekly schedule and no skipped-dates table, so the weekday chips
 * are the union of the subjects' slots and the mockup's chip row carries the
 * dated lessons instead of holidays.
 */
function CourseSchedule({
  offering,
  subjects,
  lessons,
}: {
  offering: Offering;
  subjects: SubjectWithInstructor[];
  lessons: Lesson[];
}) {
  const scheduled = lessons
    .filter((l) => l.scheduled_at)
    .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!));

  const activeDays = new Set(
    subjects
      .map((s) => s.recurring_day_of_week)
      .filter((d): d is number => d != null)
  );

  const ranges = [
    ...new Set(subjects.map(slotRange).filter((r): r is string => r != null)),
  ];
  const timeValue =
    ranges.length === 0
      ? "Not set"
      : ranges.length === 1
        ? `${ranges[0]} PKT`
        : "Varies by subject";

  const window = [offering.schedule_start, offering.schedule_end]
    .filter(Boolean)
    .map((d) => formatDate(d as string));
  const runsValue =
    window.length === 2
      ? `${window[0]} → ${window[1]}`
      : window.length === 1
        ? `From ${window[0]}`
        : "No course dates set";

  return (
    <div className="space-y-4">
      <div className={cn(courseCard, "px-[22px] py-5")}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionTitle>Class schedule</SectionTitle>
          <Link href="/dashboard/instructor/subjects" className={courseButton}>
            Edit
          </Link>
        </div>

        <div className="mb-5 flex flex-wrap gap-[7px]">
          {DAY_CHIPS.map((day, i) => {
            const on = activeDays.has(i);
            return (
              <span
                key={day}
                className={cn(
                  "rounded-[9px] px-3 py-2 text-[12.5px] font-semibold",
                  on
                    ? "bg-rose-500 text-white"
                    : "bg-rose-100/70 text-muted-foreground dark:bg-muted"
                )}
              >
                {day}
              </span>
            );
          })}
        </div>

        <div className="grid gap-3.5 min-[520px]:grid-cols-2">
          <InfoRow icon={Clock} label="Time" value={timeValue} />
          <InfoRow icon={CalendarRange} label="Runs" value={runsValue} />
        </div>
      </div>

      <div className={cn(courseCard, "px-[22px] py-5")}>
        <SectionTitle>Weekly classes</SectionTitle>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          Recurring slot per subject, in Pakistan Standard Time.
        </p>
        {subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subjects yet.</p>
        ) : (
          <ul className="divide-y divide-border-soft dark:divide-border">
            {subjects.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 truncate text-[13.5px] font-medium">
                  {s.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {scheduleDisplayLabel(s) ?? "No weekly slot set"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={cn(courseCard, "px-[22px] py-5")}>
        <SectionTitle>
          <CalendarDays className="h-4 w-4 text-rose-500" />
          Dated lessons
        </SectionTitle>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
          {scheduled.length} of {lessons.length} lessons have a date.
        </p>
        {scheduled.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lessons are scheduled yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {scheduled.map((l) => (
              <span
                key={l.id}
                className="rounded-[9px] border border-border-soft bg-[#FBF6F3] px-2.5 py-1.5 text-xs text-plum-body dark:border-border dark:bg-muted dark:text-muted-foreground"
              >
                {formatDateTime(l.scheduled_at!)} · {l.title}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500 dark:text-rose-300" />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
