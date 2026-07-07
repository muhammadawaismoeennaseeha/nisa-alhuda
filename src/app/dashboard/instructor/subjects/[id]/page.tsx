/**
 * Subject Folder — the unified per-subject view.
 *
 * One screen per subject. Lists every "Class" (a `lessons` row) with its
 * meeting link, recording, and attached resources inline. Replaces the
 * fragmented Live Hub + Resources flow as the primary instructor surface.
 *
 * Data model:
 *   subject (1) → classes (many `lessons` rows) → resources (many files
 *   per class via `resources.lesson_id`)
 *
 * Both instructors (their own subject) and admins (any subject) can use
 * this page; RLS already permits both.
 */
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LinkButton } from "@/components/ui/link-button";
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  ClipboardCheck,
  ExternalLink,
  Radio,
} from "lucide-react";
import { getDashboardViewer } from "@/lib/auth-helpers";
import { LessonList } from "./lesson-list";
import {
  hasRecurringSchedule,
  isLiveNow,
  scheduleDisplayLabel,
} from "@/lib/recurring-schedule";
import type { Lesson, Resource, Subject } from "@/lib/types/database";

export default async function SubjectFolderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const viewer = await getDashboardViewer();
  if (!viewer) return null;

  const { data: subject } = await supabase
    .from("subjects")
    .select(
      "*, offering:offerings(id, title, slug, status), instructor:profiles!subjects_instructor_id_fkey(id, full_name)"
    )
    .eq("id", id)
    .single();

  if (!subject) notFound();

  // Hard scope: instructors can only enter their own subjects. Admins
  // can enter any. RLS would reject writes anyway but this gives a clean
  // 404 instead of a half-rendered page with empty actions.
  if (!viewer.isAdmin && subject.instructor_id !== viewer.userId) {
    notFound();
  }

  const { data: lessonsData } = await supabase
    .from("lessons")
    .select("*")
    .eq("subject_id", id)
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .order("sort_order", { ascending: true });

  const lessons: Lesson[] = (lessonsData as Lesson[]) || [];
  const lessonIds = lessons.map((l) => l.id);

  // Pull every resource attached to these classes in one shot — the
  // client component will group them by lesson_id for inline display.
  let resources: Resource[] = [];
  if (lessonIds.length > 0) {
    const { data: resourcesData } = await supabase
      .from("resources")
      .select("*")
      .in("lesson_id", lessonIds)
      .order("created_at", { ascending: false });
    resources = (resourcesData as Resource[]) || [];
  }

  return (
    <div>
      <LinkButton
        variant="ghost"
        href="/dashboard/instructor"
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1.5" />
        Back to subjects
      </LinkButton>

      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-primary font-medium mb-1">
          {(subject as { offering?: { title?: string } }).offering?.title || "Subject"}
        </p>
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 ring-1 ring-primary/15 flex items-center justify-center shrink-0">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              {subject.title}
            </h1>
            {viewer.isAdmin && subject.instructor && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Instructor:{" "}
                <span className="font-medium text-foreground">
                  {(subject.instructor as { full_name?: string }).full_name}
                </span>
              </p>
            )}
            {subject.description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                {subject.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Recurring class banner — shown when admin has set the per-subject
          schedule (URL + day + time). One Join button forever. */}
      {hasRecurringSchedule(subject as Subject) && (
        <RecurringClassBanner subject={subject as Subject} />
      )}

      {/* Quiz banner — mirrors what the student sees, so admin can verify
          the link is set correctly. */}
      {(subject as Subject).quiz_url && (
        <QuizBanner quizUrl={(subject as Subject).quiz_url!} />
      )}

      <LessonList
        subjectId={id}
        offeringId={subject.offering_id}
        lessons={lessons}
        initialResources={resources}
        subjectRecurringMeetingUrl={(subject as Subject).recurring_meeting_url ?? null}
      />
    </div>
  );
}

function RecurringClassBanner({ subject }: { subject: Subject }) {
  const live = isLiveNow(subject);
  const label = scheduleDisplayLabel(subject) ?? "Recurring class";
  return (
    <div
      className={`mb-6 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center ${
        live
          ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20"
          : "border-primary/30 bg-primary/5"
      }`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15 shrink-0">
        {live ? (
          <Radio className="h-5 w-5 text-emerald-600" />
        ) : (
          <Calendar className="h-5 w-5 text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading font-semibold text-sm">
            Recurring live class
          </h2>
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              Live now
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground truncate">
          Same link every week:{" "}
          <span className="font-mono">{subject.recurring_meeting_url}</span>
        </p>
      </div>
      <a
        href={subject.recurring_meeting_url!}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors press shrink-0 ${
          live
            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
            : "bg-primary hover:bg-primary/90 text-primary-foreground"
        }`}
      >
        Join Live
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function QuizBanner({ quizUrl }: { quizUrl: string }) {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/60 dark:bg-violet-950/20 sm:flex-row sm:items-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 ring-1 ring-violet-200 shrink-0 dark:bg-violet-900/40 dark:ring-violet-900/60">
        <ClipboardCheck className="h-5 w-5 text-violet-700 dark:text-violet-300" />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="font-heading font-semibold text-sm">Quiz</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Students see a “Take Quiz” button on this subject that opens in a new tab.
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground truncate">
          <span className="font-mono">{quizUrl}</span>
        </p>
      </div>
      <a
        href={quizUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-1.5 rounded-full bg-violet-600 hover:bg-violet-700 px-4 py-2 text-sm font-semibold text-white transition-colors press shrink-0"
      >
        <ClipboardCheck className="h-4 w-4" />
        Open Quiz
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
