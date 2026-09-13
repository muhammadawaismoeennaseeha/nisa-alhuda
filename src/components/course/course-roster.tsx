"use client";

/**
 * The shared people list for a course.
 *
 * Restyled to the signed-off courses mockup: a toolbar (search, role filter,
 * "Add people") above a table whose first column is a circular initials avatar
 * with the name and email stacked beside it, and whose role and status columns
 * are pills.
 *
 * The table is deliberately narrow — Name, Role, Status, location, Enrolled.
 * The full intake record (phone, age, education) is what the existing
 * /offerings/[id]/students screen is for, and "Add people" links straight to
 * it; carrying all eight columns here only produced a table that scrolled off
 * its own card. The phone layout keeps every field, since a stacked card has
 * the room a row doesn't.
 *
 * Filtering is client-side on purpose: a course roster is tens of rows, already
 * in memory, and a round-trip per keystroke would be slower than the filter.
 * Fetching still stays with the page — this component only takes rows.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Enrollment, StudentDetails } from "@/lib/types/database";
import {
  courseButtonPrimary,
  courseCard,
  pillBase,
  pillTones,
  type PillTone,
} from "./course-surface";

/** Who someone is on the course. Enrollments are students; the other two exist
 *  so instructors and TAs can be folded into this same list later without a
 *  second roster component. */
export type CourseRole = "student" | "instructor" | "ta";

export type RosterEnrollment = Enrollment & {
  student_details: (StudentDetails & { country?: string }) | null;
  student?: { full_name: string | null } | null;
  role?: CourseRole;
};

const ROLE_PILLS: Record<CourseRole, { label: string; tone: PillTone }> = {
  student: { label: "Student", tone: "brand" },
  instructor: { label: "Instructor", tone: "steel" },
  ta: { label: "TA", tone: "warning" },
};

const ROLE_FILTERS = [
  { key: "all", label: "All" },
  { key: "student", label: "Students" },
  { key: "instructor", label: "Instructors" },
  { key: "ta", label: "TAs" },
] as const;

/** Approved is the settled state and reads sage; everything else is in-flight
 *  or refused and stays neutral grey rather than shouting in red. */
const STATUS_TONES: Record<string, PillTone> = {
  approved: "success",
  pending: "muted",
  rejected: "muted",
};

/**
 * Resolves the best display name for an enrollment row, in order of
 * preference: student_details first+last → profile.full_name → email local
 * part. The fallback matters because admin-approved enrollments (paid
 * out-of-band) and bulk-imported rows often have an empty student_details
 * JSON, which would otherwise render as "undefined undefined".
 */
export function resolveDisplayName(r: RosterEnrollment): string {
  const d = r.student_details;
  const first = d?.first_name?.trim();
  const last = d?.last_name?.trim();
  if (first || last) return [first, last].filter(Boolean).join(" ");
  const profileName = r.student?.full_name?.trim();
  if (profileName) return profileName;
  if (r.applicant_email) return r.applicant_email.split("@")[0];
  return "—";
}

/** Up to two initials for the avatar; "—" for a row with no resolvable name. */
function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter((p) => /[a-z0-9]/i.test(p));
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function cityCountryOf(r: RosterEnrollment): string {
  const d = r.student_details;
  if (!d) return "—";
  return [d.city, d.country].filter(Boolean).join(", ") || "—";
}

function formatDate(value: string, withYear = true): string {
  return new Date(value).toLocaleDateString("en-PK", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-rose-100 text-[13px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-200"
    >
      {initialsOf(name)}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn(pillBase, pillTones[STATUS_TONES[status] ?? "muted"])}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function RolePill({ role }: { role: CourseRole }) {
  const { label, tone } = ROLE_PILLS[role];
  return <span className={cn(pillBase, pillTones[tone])}>{label}</span>;
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      className={cn(
        courseCard,
        "flex flex-col items-center justify-center px-6 py-12 text-center"
      )}
    >
      <Users className="mb-4 h-10 w-10 text-rose-200 dark:text-rose-900" />
      <p className="mb-1.5 text-base text-muted-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

export function CourseRoster({
  rows,
  addHref,
  addLabel = "Add people",
  emptyTitle = "No enrolled students yet",
  emptyHint = "Once enrollments are approved, students will show up here.",
}: {
  rows: RosterEnrollment[];
  /** Where "Add people" goes. Omit it and the button isn't rendered. */
  addHref?: string;
  addLabel?: string;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] =
    useState<(typeof ROLE_FILTERS)[number]["key"]>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (roleFilter !== "all" && (r.role ?? "student") !== roleFilter) {
        return false;
      }
      if (!q) return true;
      return (
        resolveDisplayName(r).toLowerCase().includes(q) ||
        (r.applicant_email ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, roleFilter]);

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <div className={cn(courseCard, "p-5 sm:px-[22px]")}>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 focus-within:border-ring">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search people by name or email"
            placeholder="Search people by name or email…"
            className="w-full min-w-0 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div
          role="group"
          aria-label="Filter by role"
          className="inline-flex overflow-hidden rounded-[10px] border border-border"
        >
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={roleFilter === f.key}
              onClick={() => setRoleFilter(f.key)}
              className={cn(
                "cursor-pointer px-3.5 py-2 text-[12.5px] font-semibold transition-colors",
                roleFilter === f.key
                  ? "bg-rose-500 text-white"
                  : "bg-card text-muted-foreground hover:bg-rose-50 dark:hover:bg-rose-950/40"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {addHref && (
          <Link href={addHref} className={courseButtonPrimary}>
            <Plus className="h-4 w-4" />
            {addLabel}
          </Link>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No one on this course matches that search.
        </p>
      ) : (
        <>
          <div className="-mx-[22px] hidden overflow-x-auto px-[22px] md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Name", "Role", "Status", "City / Country", "Enrolled"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3.5 pb-2.5 text-left text-[11px] font-semibold tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const name = resolveDisplayName(r);
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-border-soft transition-colors hover:bg-rose-50/50 dark:border-border dark:hover:bg-rose-950/20"
                    >
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={name} />
                          <div className="min-w-0">
                            <div className="text-[13.5px] font-medium">
                              {name}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {r.applicant_email || "—"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3.5 py-3">
                        <RolePill role={r.role ?? "student"} />
                      </td>
                      <td className="px-3.5 py-3">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-3.5 py-3 text-[13.5px] text-muted-foreground">
                        {cityCountryOf(r)}
                      </td>
                      <td className="px-3.5 py-3 text-xs whitespace-nowrap text-muted-foreground">
                        {formatDate(r.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {filtered.map((r) => {
              const d = r.student_details;
              const name = resolveDisplayName(r);
              const cityCountry = cityCountryOf(r);
              return (
                <div
                  key={r.id}
                  className="rounded-[10px] border border-border-soft p-4 dark:border-border"
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold">{name}</h3>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(r.created_at, false)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <RolePill role={r.role ?? "student"} />
                        <StatusPill status={r.status} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {r.applicant_email || "—"}
                      </span>
                    </div>
                    {d?.phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <span>{d.phone}</span>
                      </div>
                    )}
                    {d?.age && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        <span>Age {d.age}</span>
                      </div>
                    )}
                    {cityCountry !== "—" && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span>{cityCountry}</span>
                      </div>
                    )}
                    {d?.education_level && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                        <span>{d.education_level}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
