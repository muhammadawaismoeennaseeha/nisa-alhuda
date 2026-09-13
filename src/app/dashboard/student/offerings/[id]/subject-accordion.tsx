/**
 * Subject Accordion — the student's view of a course's subjects and classes.
 *
 * Phase 4 re-skins this onto the shared course vocabulary in
 * `@/components/course/course-surface`: each subject is a white course card on
 * cream, and its classes are a hairline-separated list of rows, each led by the
 * rose numbered square from the signed-off mockup.
 *
 * ─── Recordings ────────────────────────────────────────────────────────────
 *
 * This is the watch side of `lessons.recording_url`. It is read-only here —
 * nothing on this screen writes that column. The re-skin is presentation only,
 * and all three existing watch paths survive it unchanged:
 *
 *   1. YouTube URLs still render `<RecordingPlayer url={lesson.recording_url}/>`
 *      full-width under the row, which lazily boots Plyr on click.
 *   2. Non-YouTube URLs still render a plain `target="_blank"` anchor straight
 *      at `lesson.recording_url`.
 *   3. Neither is gated on schedule or completion — a lesson that has a
 *      recording offers it, full stop. `isPast` only decides whether the
 *      "Recording available" chip is shown next to it.
 *
 * The completion toggle ("Watch" / "Watched") writes `lesson_progress` only.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Video,
  PlayCircle,
  CheckCircle,
  Circle,
  Loader2,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  Download,
  ExternalLink,
  Globe,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isExternalUrl } from "@/lib/resource-helpers";
import {
  hasRecurringSchedule,
  isLiveNow,
  isClassDayPkt,
  scheduleDisplayLabel,
  computeNextOccurrence,
} from "@/lib/recurring-schedule";
import { RecordingPlayer } from "@/components/lesson/recording-player";
import { isYouTubeUrl } from "@/lib/video-helpers";
import {
  courseButton,
  courseButtonPrimary,
  courseCard,
  courseIconButton,
  courseTag,
  iconTints,
  pillBase,
  pillTones,
} from "@/components/course/course-surface";
import { ProgressRing } from "@/components/ui/progress-ring";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Subject, Lesson, Resource } from "@/lib/types/database";

interface SubjectAccordionProps {
  subjects: (Subject & { instructor: { full_name: string } | null })[];
  lessonsBySubject: Record<string, Lesson[]>;
  resourcesBySubject: Record<string, Resource[]>;
  completedLessonIds: string[];
  offeringId: string;
}

/** The hairline that separates rows inside a course card. */
const HAIRLINE = "border-border-soft dark:border-border";

/** The uppercase section label above Resources / Classes. */
const SECTION_LABEL =
  "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";

const FILE_ICON_MAP: Record<string, typeof FileText> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  png: ImageIcon,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  webp: ImageIcon,
};
function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return FILE_ICON_MAP[ext] || FileIcon;
}
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function SubjectAccordion({
  subjects,
  lessonsBySubject,
  resourcesBySubject,
  completedLessonIds,
  offeringId,
}: SubjectAccordionProps) {
  const router = useRouter();
  // Local state for optimistic updates
  const [completedSet, setCompletedSet] = useState<Set<string>>(
    new Set(completedLessonIds)
  );
  const [loadingLesson, setLoadingLesson] = useState<string | null>(null);

  // Open the first subject by default
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(
    new Set(subjects.length > 0 ? [subjects[0].id] : [])
  );

  function toggleSubject(id: string) {
    setOpenSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function toggleComplete(lessonId: string) {
    const isCompleted = completedSet.has(lessonId);
    setLoadingLesson(lessonId);

    // Optimistic update
    setCompletedSet((prev) => {
      const next = new Set(prev);
      if (isCompleted) {
        next.delete(lessonId);
      } else {
        next.add(lessonId);
      }
      return next;
    });

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Not authenticated");

      if (isCompleted) {
        // Un-mark: delete the progress record
        const { error } = await supabase
          .from("lesson_progress")
          .delete()
          .eq("student_id", user.id)
          .eq("lesson_id", lessonId);
        if (error) throw error;
      } else {
        // Mark complete: insert progress record
        const { error } = await supabase.from("lesson_progress").insert({
          student_id: user.id,
          lesson_id: lessonId,
          offering_id: offeringId,
        });
        if (error) throw error;
      }

      router.refresh();
    } catch {
      // Revert optimistic update
      setCompletedSet((prev) => {
        const next = new Set(prev);
        if (isCompleted) {
          next.add(lessonId);
        } else {
          next.delete(lessonId);
        }
        return next;
      });
      toast.error("Failed to update progress.");
    } finally {
      setLoadingLesson(null);
    }
  }

  // Calculate per-subject progress
  function getSubjectProgress(subjectId: string) {
    const lessons = lessonsBySubject[subjectId] || [];
    if (lessons.length === 0) return { completed: 0, total: 0, pct: 0 };
    const completed = lessons.filter((l) => completedSet.has(l.id)).length;
    return {
      completed,
      total: lessons.length,
      pct: Math.round((completed / lessons.length) * 100),
    };
  }

  return (
    <div className="space-y-3">
      {subjects.map((subject, subjectIndex) => {
        const lessons = lessonsBySubject[subject.id] || [];
        const resources = resourcesBySubject[subject.id] ?? [];
        const isOpen = openSubjects.has(subject.id);
        const progress = getSubjectProgress(subject.id);

        // "6 lessons · 3 watched · Ustadha Maryam" — the mockup's subject
        // meta line, filled with Nisa's real per-student progress.
        const meta = [
          plural(lessons.length, "lesson"),
          progress.total > 0 ? `${progress.completed} watched` : null,
          subject.instructor?.full_name,
        ]
          .filter(Boolean)
          .join(" · ");

        const hasIntro =
          !!subject.description ||
          hasRecurringSchedule(subject) ||
          !!subject.quiz_url ||
          resources.length > 0;

        return (
          <div key={subject.id} className={courseCard}>
            {/* Subject header — clickable */}
            <button
              onClick={() => toggleSubject(subject.id)}
              aria-expanded={isOpen}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3.5 rounded-t-[var(--radius)] px-[18px] py-4 text-left transition-colors",
                isOpen
                  ? "bg-rose-50/60 dark:bg-rose-950/20"
                  : "hover:bg-rose-50/40 dark:hover:bg-rose-950/10"
              )}
            >
              {/* Numbered subject tile — the top of the same numbered
                  language the lesson rows use, one size up and filled. */}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 text-sm font-bold text-white tabular-nums shadow-sm dark:from-rose-600 dark:to-rose-700">
                {subjectIndex + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="font-heading flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold">
                  <span>{subject.title}</span>
                  {progress.total > 0 && progress.pct === 100 && (
                    <span className={cn(pillBase, pillTones.success)}>
                      Complete
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {meta}
                </span>
              </span>

              {/* Circular progress ring — subject completion at a glance */}
              {progress.total > 0 && (
                <ProgressRing
                  pct={progress.pct}
                  size={38}
                  strokeWidth={3}
                  label={null}
                  className="shrink-0"
                />
              )}

              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
                  isOpen
                    ? "bg-rose-100/70 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300"
                    : "text-muted-foreground"
                )}
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-200",
                    !isOpen && "-rotate-90"
                  )}
                />
              </span>
            </button>

            {isOpen && (
              <>
                {/* Description + live class + quiz + resources */}
                {hasIntro && (
                  <div
                    className={cn(
                      "space-y-3.5 border-t px-[18px] py-4",
                      HAIRLINE
                    )}
                  >
                    {subject.description && (
                      <p className="text-sm text-muted-foreground">
                        {subject.description}
                      </p>
                    )}

                    {/* Recurring class card — the always-visible Join button.
                        Renders only when the subject has a full schedule set
                        by admin (URL + day + time). */}
                    {hasRecurringSchedule(subject) && (
                      <RecurringClassCard subject={subject} />
                    )}

                    {/* Quiz card — persistent Take Quiz button. Renders only
                        when admin has set an external quiz URL on the subject
                        (typically a Google Form). */}
                    {subject.quiz_url && <QuizCard quizUrl={subject.quiz_url} />}

                    {/* Resources block — the subject's downloadable files. */}
                    {resources.length > 0 && (
                      <div>
                        <h4 className={SECTION_LABEL}>
                          <FileText className="h-3.5 w-3.5 text-rose-500 dark:text-rose-300" />
                          Resources
                          <span className="font-normal tracking-normal normal-case">
                            · downloadable for this subject
                          </span>
                        </h4>
                        <div className="mt-2 space-y-2">
                          {resources.map((r) => {
                            const isLink = isExternalUrl(r.file_url);
                            const Icon = isLink ? Globe : getFileIcon(r.title);
                            return (
                              <div
                                key={r.id}
                                className={cn(
                                  "flex items-center gap-3 rounded-[10px] border p-2.5",
                                  HAIRLINE
                                )}
                              >
                                <div
                                  className={cn(
                                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                                    iconTints.brand
                                  )}
                                >
                                  <Icon className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[13.5px] font-medium">
                                    {r.title}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {isLink ? (
                                      <>
                                        <span className="font-medium text-rose-700 dark:text-rose-300">
                                          External link
                                        </span>{" "}
                                        · {new URL(r.file_url).hostname}
                                      </>
                                    ) : (
                                      <>
                                        {formatFileSize(r.file_size)} ·{" "}
                                        <span className="uppercase">
                                          {r.file_type}
                                        </span>
                                      </>
                                    )}
                                  </p>
                                </div>
                                <ResourceActions
                                  path={r.file_url}
                                  fileName={r.title}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Classes (real scheduled or live-linked sessions) */}
                {lessons.length === 0 ? (
                  <p
                    className={cn(
                      "border-t px-[18px] py-6 text-center text-sm text-muted-foreground",
                      HAIRLINE
                    )}
                  >
                    No classes have been added to this subject yet. Check back
                    soon.
                  </p>
                ) : (
                  <div className={cn("border-t", HAIRLINE)}>
                    <h4 className={cn(SECTION_LABEL, "px-[18px] pt-3.5 pb-1")}>
                      Classes
                    </h4>
                    <ul>
                      {lessons.map((lesson, lessonIndex) => (
                        <LessonRow
                          key={lesson.id}
                          lesson={lesson}
                          index={lessonIndex + 1}
                          isCompleted={completedSet.has(lesson.id)}
                          isLoading={loadingLesson === lesson.id}
                          onToggleComplete={() => toggleComplete(lesson.id)}
                        />
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Lesson row ───────────────────────────────────────────────────────── */

function LessonRow({
  lesson,
  index,
  isCompleted,
  isLoading,
  onToggleComplete,
}: {
  lesson: Lesson;
  index: number;
  isCompleted: boolean;
  isLoading: boolean;
  onToggleComplete: () => void;
}) {
  const now = new Date();
  const scheduledAt = lesson.scheduled_at
    ? new Date(lesson.scheduled_at)
    : null;
  const isUpcoming = scheduledAt ? scheduledAt > now : false;
  const isPast = scheduledAt ? scheduledAt < now : false;

  const recordingIsYoutube =
    lesson.recording_url && isYouTubeUrl(lesson.recording_url);

  const when = scheduledAt
    ? `${scheduledAt.toLocaleString("en-PK", {
        timeZone: "Asia/Karachi",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })} PKT`
    : null;

  return (
    <li
      className={cn(
        "border-t transition-colors",
        HAIRLINE,
        isCompleted
          ? "bg-sage-50/60 dark:bg-emerald-950/10"
          : "hover:bg-rose-50/30 dark:hover:bg-rose-950/10"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-[18px] py-3">
        {/* The mockup's numbered square — turns into a sage check once
            the class is watched, so "done" reads at a glance down the list. */}
        <span
          className={cn(
            "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums transition-colors",
            isCompleted
              ? "bg-sage-50 text-sage-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300"
          )}
        >
          {isCompleted ? <CheckCircle className="h-3.5 w-3.5" /> : index}
        </span>

        {/* Lesson info */}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-[13.5px] font-medium",
              isCompleted && "text-muted-foreground line-through"
            )}
          >
            {lesson.title}
          </p>
          {when && (
            <p className="mt-0.5 text-xs text-muted-foreground">{when}</p>
          )}
          {lesson.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {lesson.description}
            </p>
          )}
        </div>

        {isUpcoming && (
          <span className={cn(pillBase, pillTones.warning)}>Upcoming</span>
        )}

        {isPast && lesson.recording_url && (
          <span className={courseTag}>Recording available</span>
        )}

        {/* Live class link */}
        {lesson.live_class_link && isUpcoming && (
          <a
            href={lesson.live_class_link}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(courseButtonPrimary, "press")}
          >
            <Video className="h-3.5 w-3.5" />
            Join live
          </a>
        )}

        {/* Recording link — a plain external anchor, used only when the URL is
            NOT YouTube. YouTube URLs render as the inline player below. */}
        {lesson.recording_url && !recordingIsYoutube && (
          <a
            href={lesson.recording_url}
            target="_blank"
            rel="noopener noreferrer"
            className={courseButton}
          >
            <PlayCircle className="h-3.5 w-3.5" />
            Watch recording
          </a>
        )}

        {/* Completion toggle */}
        <button
          onClick={onToggleComplete}
          disabled={isLoading}
          className={cn(
            courseButton,
            "cursor-pointer",
            isCompleted &&
              "border-sage-200 bg-sage-50 text-sage-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
          )}
          title={isCompleted ? "Mark as incomplete" : "Mark as complete"}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isCompleted ? (
            <CheckCircle className="h-3.5 w-3.5" />
          ) : (
            <Circle className="h-3.5 w-3.5" />
          )}
          {isCompleted ? "Watched" : "Watch"}
        </button>
      </div>

      {/* Collapsible YouTube player — full width, below the lesson row.
          Renders only a "Watch recording ▼" button until the student
          clicks it, so the iframe URL never ends up in the initial DOM. */}
      {recordingIsYoutube && lesson.recording_url && (
        <div className="px-[18px] pb-3.5">
          <RecordingPlayer url={lesson.recording_url} />
        </div>
      )}
    </li>
  );
}

/**
 * Permanent "Live class" card per subject — uses the recurring schedule
 * fields on `subjects` (migration 024). Replaces the per-class manual
 * scheduling: admin sets URL + day + time once and students see the
 * Join button forever, plus a "Live now" pulse when the class is in
 * progress.
 */
function RecurringClassCard({ subject }: { subject: Subject }) {
  // One timestamp for the whole render — live state, next occurrence and the
  // countdown all have to agree with each other.
  const now = new Date();
  const live = isLiveNow(subject, now);
  const occ = computeNextOccurrence(subject, now);
  const label = scheduleDisplayLabel(subject) ?? "Recurring class";
  const url = subject.recurring_meeting_url!;
  // Join button only shows on the configured weekly day-of-week (PKT).
  // On other days the card still renders with the schedule label and
  // countdown, but no clickable Join — students can't accidentally
  // open Tuesday's Arabic meeting on a Saturday afternoon.
  const showJoin = live || isClassDayPkt(subject, now);

  // "Starts in 2h 15m" / "Starts in 3 days" string for the upcoming case.
  let countdown: string | null = null;
  if (!live && occ) {
    const diffMs = occ.start.getTime() - now.getTime();
    if (diffMs > 0) {
      const mins = Math.round(diffMs / 60000);
      if (mins < 60) countdown = `Starts in ${mins} min`;
      else if (mins < 60 * 24)
        countdown = `Starts in ${Math.floor(mins / 60)}h ${mins % 60}m`;
      else countdown = `Starts in ${Math.floor(mins / 60 / 24)}d`;
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[10px] border p-3.5 sm:flex-row sm:items-center",
        live
          ? "border-sage-200 bg-sage-50 dark:border-emerald-900 dark:bg-emerald-950/20"
          : "border-border-soft bg-rose-50/50 dark:border-border dark:bg-rose-950/20"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-heading text-[13.5px] font-semibold">
            Live class
          </h4>
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-700 px-2 py-0.5 text-[10px] font-bold tracking-[0.05em] uppercase text-white dark:bg-emerald-700">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              Live now
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
        {countdown && (
          <p className="mt-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
            {countdown}
          </p>
        )}
      </div>
      {showJoin && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            courseButtonPrimary,
            "press justify-center",
            live &&
              "border-sage-700 bg-sage-700 hover:border-sage-700/90 hover:bg-sage-700/90 dark:border-emerald-700 dark:bg-emerald-700"
          )}
        >
          <Video className="h-4 w-4" />
          Join Live
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

/**
 * External quiz launcher — one button that opens the subject's quiz
 * (Google Form) in a new tab. No schedule state; the button is always
 * clickable as long as `quiz_url` is set on the subject row.
 */
function QuizCard({ quizUrl }: { quizUrl: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[10px] border p-3.5 sm:flex-row sm:items-center",
        HAIRLINE
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-steel-700 dark:text-sky-300" />
          <h4 className="font-heading text-[13.5px] font-semibold">Quiz</h4>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Test your understanding — opens in a new tab.
        </p>
      </div>
      <a
        href={quizUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(courseButton, "press justify-center")}
      >
        <ClipboardCheck className="h-4 w-4" />
        Take Quiz
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

/**
 * Open + Download buttons for a private resource. Uses createSignedUrl
 * (10-min window). Download forces Content-Disposition: attachment so
 * the browser actually saves the file rather than previewing it.
 */
function ResourceActions({
  path,
  fileName,
}: {
  path: string;
  fileName?: string;
}) {
  const [busy, setBusy] = useState<"open" | "download" | null>(null);
  const external = isExternalUrl(path);

  async function getUrl(forDownload: boolean): Promise<string | null> {
    // External URLs (Drive, etc.) are passed straight through —
    // no signing, no expiry, no download forcing (Drive handles it).
    if (external) return path;
    const supabase = createClient();
    const opts = forDownload ? { download: fileName || true } : undefined;
    const { data, error } = await supabase.storage
      .from("resources")
      .createSignedUrl(path, 60 * 10, opts);
    if (error || !data?.signedUrl) {
      toast.error("Could not get this file. Please try again.");
      return null;
    }
    return data.signedUrl;
  }

  async function handleOpen() {
    setBusy("open");
    try {
      const url = await getUrl(false);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload() {
    setBusy("download");
    try {
      const url = await getUrl(true);
      if (!url) return;
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "";
      if (external) a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={courseIconButton}
        onClick={handleOpen}
        disabled={busy !== null}
        aria-label={external ? "Open link in new tab" : "Open in new tab"}
        title={external ? "Open link in new tab" : "Open in new tab"}
      >
        {busy === "open" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ExternalLink className="h-3.5 w-3.5" />
        )}
      </button>
      {!external && (
        <button
          type="button"
          className={courseIconButton}
          onClick={handleDownload}
          disabled={busy !== null}
          aria-label="Download"
          title="Download"
        >
          {busy === "download" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
