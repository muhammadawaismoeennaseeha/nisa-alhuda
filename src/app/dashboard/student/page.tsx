/**
 * Student Dashboard — "My Learning" hub.
 * Shows approved enrollments as active learning cards, plus a summary of
 * pending enrollments. Greeting + stats + live-now banner live above the
 * grid so students always land on a meaningful overview.
 */
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  courseButtonPrimary,
  courseCard,
  courseCardHover,
  courseTag,
  iconTints,
  pillBase,
  pillTones,
} from "@/components/course/course-surface";
import { LinkButton } from "@/components/ui/link-button";
import {
  BookOpen,
  ArrowRight,
  Clock,
  GraduationCap,
  Calendar,
  Video,
  CheckCircle,
  ExternalLink,
  Flame,
  Sparkles,
} from "lucide-react";
import type {
  Offering,
  LiveSession,
  Profile as ProfileType,
} from "@/lib/types/database";
import { DashboardGreeting } from "@/components/dashboard/greeting";
import { StatCard } from "@/components/dashboard/stat-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ProgressRing } from "@/components/ui/progress-ring";

export default async function StudentDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  // Fetch all enrollments with offering details
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("*, offering:offerings(*)")
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });

  const approved = enrollments?.filter((e) => e.status === "approved") || [];
  const pending = enrollments?.filter((e) => e.status === "pending") || [];

  const approvedOfferingIds = approved.map((e) => e.offering_id);
  let lessonCounts: Record<string, number> = {};
  let completedCounts: Record<string, number> = {};
  let liveSessions: (LiveSession & {
    instructor: ProfileType;
    offering: Offering;
  })[] = [];

  const now = new Date();

  const [lessonsResult, progressResult, sessionsResult] =
    await Promise.all([
      approvedOfferingIds.length > 0
        ? supabase
            .from("lessons")
            .select("offering_id")
            .in("offering_id", approvedOfferingIds)
            .eq("is_published", true)
        : Promise.resolve({ data: null }),
      approvedOfferingIds.length > 0
        ? supabase
            .from("lesson_progress")
            .select("offering_id")
            .eq("student_id", user.id)
            .in("offering_id", approvedOfferingIds)
        : Promise.resolve({ data: null }),
      supabase
        .from("live_sessions")
        .select(
          "*, instructor:profiles!live_sessions_instructor_id_fkey(*), offering:offerings!live_sessions_offering_id_fkey(*)"
        )
        .gte(
          "scheduled_at",
          new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()
        )
        .order("scheduled_at", { ascending: true })
        .then((res) => res as { data: typeof liveSessions | null }),
    ]);

  if (lessonsResult.data) {
    lessonCounts = lessonsResult.data.reduce(
      (acc, l: { offering_id: string }) => {
        acc[l.offering_id] = (acc[l.offering_id] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  if (progressResult.data) {
    completedCounts = progressResult.data.reduce(
      (acc, p: { offering_id: string }) => {
        acc[p.offering_id] = (acc[p.offering_id] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  if (sessionsResult.data) {
    liveSessions = (sessionsResult.data as typeof liveSessions).filter((s) => {
      const start = new Date(s.scheduled_at);
      const end = new Date(start.getTime() + s.duration_minutes * 60 * 1000);
      return now >= start && now <= end;
    });
  }

  // Aggregate stats across all approved enrollments.
  const totalLessons = Object.values(lessonCounts).reduce((a, b) => a + b, 0);
  const totalCompleted = Object.values(completedCounts).reduce(
    (a, b) => a + b,
    0
  );
  const overallPct =
    totalLessons > 0 ? Math.round((totalCompleted / totalLessons) * 100) : 0;

  const tail =
    approved.length > 0
      ? `You're ${overallPct}% through your lessons — keep going.`
      : pending.length > 0
        ? `${pending.length} enrollment${pending.length > 1 ? "s are" : " is"} awaiting review.`
        : "Browse the catalog to find your next course.";

  return (
    <div>
      <DashboardGreeting
        name={profile?.full_name || "Sister"}
        role={profile?.role || "student"}
        tail={tail}
      />

      {/* Stats strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Active"
          value={approved.length}
          hint="courses enrolled"
          icon={GraduationCap}
        />
        <StatCard
          label="Lessons"
          value={`${totalCompleted}/${totalLessons}`}
          hint="completed"
          icon={CheckCircle}
          accent="text-emerald-600"
        />
        <StatCard
          label="Progress"
          value={`${overallPct}%`}
          hint="overall"
          icon={Flame}
          accent="text-amber-600"
        />
        <StatCard
          label="Live now"
          value={liveSessions.length}
          hint={liveSessions.length > 0 ? "join from below" : "nothing live"}
          icon={Video}
          accent="text-rose-600"
        />
      </div>

      {/* Live Now Banner */}
      {liveSessions.length > 0 && (
        <div className="mb-6 space-y-3">
          {liveSessions.map((session) => {
            const startedAgo = Math.floor(
              (new Date().getTime() -
                new Date(session.scheduled_at).getTime()) /
                (1000 * 60)
            );
            return (
              <div
                key={session.id}
                className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-4 dark:border-red-900 dark:from-red-950/30 dark:to-rose-950/20 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="relative shrink-0">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-100 dark:bg-red-950/40">
                      <Video className="h-5 w-5 text-red-600" />
                    </div>
                    <span className="absolute -right-1 -top-1 flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-red-900 dark:text-red-100">
                      LIVE NOW · {session.title}
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-300">
                      {session.instructor?.full_name} · Started {startedAgo}m
                      ago
                    </p>
                  </div>
                </div>
                <a
                  href={session.meeting_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Join Now
                </a>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending enrollments notice */}
      {pending.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="mb-1 flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              {pending.length} enrollment{pending.length > 1 ? "s" : ""} pending
              review
            </p>
          </div>
          <p className="ml-6 text-xs text-amber-800 dark:text-amber-300">
            Your enrollment{pending.length > 1 ? "s are" : " is"} being
            reviewed. You&apos;ll get access once approved.{" "}
            <LinkButton
              variant="link"
              href="/dashboard/student/enrollments"
              className="h-auto p-0 text-xs text-amber-900 underline dark:text-amber-100"
            >
              View details
            </LinkButton>
          </p>
        </div>
      )}

      {/* Active Learning */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">
          {approved.length > 0 ? "Continue learning" : "Your courses"}
        </h2>
        {approved.length > 0 && (
          <LinkButton
            variant="ghost"
            size="sm"
            href="/dashboard/student/enrollments"
            className="text-xs"
          >
            Manage enrollments
            <ArrowRight className="ml-1 h-3 w-3" />
          </LinkButton>
        )}
      </div>

      {approved.length === 0 && pending.length === 0 ? (
        <div className="space-y-3">
          <EmptyState
            icon={Sparkles}
            title="No enrollments yet"
            description="Browse our catalog to discover programs, courses, and workshops designed for your journey."
            action={<LinkButton href="/offerings">Browse Catalog</LinkButton>}
          />
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 dark:border-amber-800/40 dark:bg-amber-950/20 p-4 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Already paid for a course?
            </p>
            <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">
              If you&apos;ve already paid via bank transfer or WhatsApp and your
              course isn&apos;t showing up here, please email{" "}
              <a
                href="mailto:support@nisaalhuda.org"
                className="font-medium underline"
              >
                support@nisaalhuda.org
              </a>{" "}
              with the email you used when you paid — an admin will activate
              your enrollment.
            </p>
          </div>
        </div>
      ) : approved.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No active courses yet"
          description="Your enrollments are being reviewed. You'll see your courses here once approved — usually within a day."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {approved.map((enrollment) => {
            const offering = enrollment.offering as Offering;
            const count = lessonCounts[offering.id] || 0;
            const completed = completedCounts[offering.id] || 0;
            const pct = count > 0 ? Math.round((completed / count) * 100) : 0;

            return (
              <div
                key={enrollment.id}
                className={cn(courseCard, courseCardHover, "group p-5")}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div
                    className={cn(
                      "flex h-[38px] w-[38px] items-center justify-center rounded-[10px] transition-transform group-hover:scale-105",
                      iconTints.brand
                    )}
                  >
                    <BookOpen className="h-[18px] w-[18px]" />
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <span className={cn(pillBase, pillTones.success)}>
                      Enrolled
                    </span>
                  </div>
                </div>

                <h3 className="font-heading mb-1 text-lg leading-tight font-semibold">
                  {offering.title}
                </h3>

                {offering.short_description && (
                  <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                    {offering.short_description}
                  </p>
                )}

                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                  {offering.schedule_start && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(offering.schedule_start).toLocaleDateString(
                        "en-PK",
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        }
                      )}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Video className="h-3 w-3" />
                    {count} {count === 1 ? "lesson" : "lessons"}
                  </span>
                  <span className={courseTag}>
                    {offering.type === "program"
                      ? "Program"
                      : offering.type === "course"
                        ? "Course"
                        : "Workshop"}
                  </span>
                </div>

                {count > 0 && (
                  <div className="mb-4 flex items-center gap-3">
                    <ProgressRing pct={pct} size={52} strokeWidth={4} />
                    <div>
                      <p
                        className={`text-sm font-semibold ${
                          pct === 100 ? "text-sage-700" : "text-foreground"
                        }`}
                      >
                        {pct === 100 ? "Complete!" : `${pct}% done`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {completed} of {count}{" "}
                        {count === 1 ? "lesson" : "lessons"} watched
                      </p>
                    </div>
                  </div>
                )}

                <div className="border-t border-border-soft pt-3.5 dark:border-border">
                  <Link
                    href={`/dashboard/student/offerings/${offering.id}`}
                    className={cn(
                      courseButtonPrimary,
                      "press w-full justify-center"
                    )}
                  >
                    {pct === 100 ? "Review Course" : "Continue Learning"}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
