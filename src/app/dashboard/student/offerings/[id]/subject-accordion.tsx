/**
 * Subject Accordion — expandable subject sections with lesson cards.
 * Students can view lesson details, join live classes, watch recordings,
 * and mark lessons as complete with progress tracking.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Video,
  Calendar,
  PlayCircle,
  BookOpen,
  User,
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
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-4">
      {subjects.map((subject) => {
        const lessons = lessonsBySubject[subject.id] || [];
        const isOpen = openSubjects.has(subject.id);
        const progress = getSubjectProgress(subject.id);

        return (
          <Card key={subject.id}>
            {/* Subject Header — clickable */}
            <button
              onClick={() => toggleSubject(subject.id)}
              className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors rounded-t-xl"
            >
              <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                <BookOpen className="h-4 w-4 text-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-heading font-semibold truncate">
                    {subject.title}
                  </h3>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {lessons.length}{" "}
                    {lessons.length === 1 ? "lesson" : "lessons"}
                  </Badge>
                  {progress.total > 0 && progress.pct === 100 && (
                    <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400 shrink-0">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Complete
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {subject.instructor && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {subject.instructor.full_name}
                    </p>
                  )}
                  {progress.total > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {progress.completed}/{progress.total} done
                    </p>
                  )}
                </div>

              </div>

              {/* Circular progress ring — shows subject completion at a glance */}
              {progress.total > 0 && (
                <ProgressRing
                  pct={progress.pct}
                  size={38}
                  strokeWidth={3}
                  label={null}
                  className="shrink-0"
                />
              )}

              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0 ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {/* Subject Description + Resources + Classes */}
            {isOpen && (
              <CardContent className="pt-0 pb-4 px-4">
                {subject.description && (
                  <p className="text-sm text-muted-foreground mb-4 ml-12">
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
                    (typically a Google Form). Positioned right after the
                    live class so it sits with the other subject-level
                    actions, above Resources. */}
                {subject.quiz_url && (
                  <QuizCard quizUrl={subject.quiz_url} />
                )}

                {/* Resources block — surfaces the subject's downloadable
                    files at the top of the expanded panel. */}
                {(resourcesBySubject[subject.id]?.length ?? 0) > 0 && (
                  <div className="ml-3 mb-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      Resources
                      <span className="font-normal normal-case tracking-normal">
                        · downloadable for this subject
                      </span>
                    </h4>
                    <div className="space-y-2">
                      {resourcesBySubject[subject.id]!.map((r) => {
                        const isLink = isExternalUrl(r.file_url);
                        const Icon = isLink ? Globe : getFileIcon(r.title);
                        return (
                          <div
                            key={r.id}
                            className="flex items-center gap-3 rounded-lg border bg-background p-2.5"
                          >
                            <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                              <Icon className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {r.title}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {isLink ? (
                                  <>
                                    <span className="text-primary font-medium">
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

                {/* Classes (real scheduled or live-linked sessions) */}
                {lessons.length === 0 ? (
                  <div className="ml-12 py-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      No classes have been added to this subject yet. Check back soon.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 ml-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-primary" />
                      Classes
                    </h4>
                    {lessons.map((lesson, lessonIndex) => (
                      <LessonCard
                        key={lesson.id}
                        lesson={lesson}
                        index={lessonIndex + 1}
                        isCompleted={completedSet.has(lesson.id)}
                        isLoading={loadingLesson === lesson.id}
                        onToggleComplete={() => toggleComplete(lesson.id)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function LessonCard({
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

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isCompleted
          ? "bg-green-50/50 dark:bg-green-950/10 border-green-200 dark:border-green-900/30"
          : "bg-background hover:bg-muted/20"
      }`}
    >
      <div className="flex items-start gap-3 p-3">
      {/* Completion toggle */}
      <button
        onClick={onToggleComplete}
        disabled={isLoading}
        className="mt-0.5 shrink-0 transition-colors flex flex-col items-center gap-0.5"
        title={isCompleted ? "Mark as incomplete" : "Mark as complete"}
      >
        {isLoading ? (
          <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
        ) : isCompleted ? (
          <CheckCircle className="h-6 w-6 text-green-600" />
        ) : (
          <Circle className="h-6 w-6 text-muted-foreground/40 hover:text-primary" />
        )}
        {!isLoading && (
          <span
            className={`text-[9px] font-medium leading-none ${
              isCompleted ? "text-green-600" : "text-muted-foreground/60"
            }`}
          >
            {isCompleted ? "Watched" : "Watch"}
          </span>
        )}
      </button>

      {/* Lesson info */}
      <div className="flex-1 min-w-0">
        <h4
          className={`font-medium text-sm mb-1 ${
            isCompleted ? "text-muted-foreground line-through" : ""
          }`}
        >
          {lesson.title}
        </h4>

        {lesson.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {lesson.description}
          </p>
        )}

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {scheduledAt && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {scheduledAt.toLocaleString("en-PK", {
                timeZone: "Asia/Karachi",
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              PKT
            </span>
          )}
          {isUpcoming && (
            <Badge
              variant="outline"
              className="text-xs text-amber-600 border-amber-300"
            >
              Upcoming
            </Badge>
          )}
          {isPast && lesson.recording_url && (
            <Badge
              variant="outline"
              className="text-xs text-green-600 border-green-300"
            >
              Recording Available
            </Badge>
          )}
        </div>
      </div>

      {/* Action buttons (defined further down) */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Live class link */}
        {lesson.live_class_link && isUpcoming && (
          <a
            href={lesson.live_class_link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors press"
          >
            <Video className="h-3 w-3" />
            Join
          </a>
        )}

        {/* Recording link — pill button only when URL is NOT YouTube
            (YouTube URLs render as a full-width inline embed below). */}
        {lesson.recording_url && !recordingIsYoutube && (
          <a
            href={lesson.recording_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          >
            <PlayCircle className="h-3 w-3" />
            Watch
          </a>
        )}
      </div>
      </div>

      {/* Collapsible YouTube player — full width, below the lesson header.
          Renders only a "Watch recording ▼" button until the student
          clicks it, so the iframe URL never ends up in the initial DOM. */}
      {recordingIsYoutube && lesson.recording_url && (
        <div className="px-3 pb-3">
          <RecordingPlayer url={lesson.recording_url} />
        </div>
      )}
    </div>
  );
}

/**
 * Permanent "Live class" card per subject — uses the recurring schedule
 * fields on `subjects` (migration 024). Replaces the per-class manual
 * scheduling: admin sets URL + day + time once and students see the
 * Join button forever, plus a "Live now" pulse when the class is in
 * progress.
 */
function RecurringClassCard({
  subject,
}: {
  subject: Subject;
}) {
  const live = isLiveNow(subject);
  const occ = computeNextOccurrence(subject);
  const label = scheduleDisplayLabel(subject) ?? "Recurring class";
  const url = subject.recurring_meeting_url!;
  // Join button only shows on the configured weekly day-of-week (PKT).
  // On other days the card still renders with the schedule label and
  // countdown, but no clickable Join — students can't accidentally
  // open Tuesday's Arabic meeting on a Saturday afternoon.
  const showJoin = live || isClassDayPkt(subject);

  // "Starts in 2h 15m" / "Starts in 3 days" string for the upcoming case.
  let countdown: string | null = null;
  if (!live && occ) {
    const diffMs = occ.start.getTime() - Date.now();
    if (diffMs > 0) {
      const mins = Math.round(diffMs / 60000);
      if (mins < 60) countdown = `Starts in ${mins} min`;
      else if (mins < 60 * 24)
        countdown = `Starts in ${Math.floor(mins / 60)}h ${mins % 60}m`;
      else countdown = `Starts in ${Math.floor(mins / 60 / 24)}d`;
    }
  }

  return (
    <div className="ml-3 mb-4">
      <div
        className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center ${
          live
            ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20"
            : "border-primary/30 bg-primary/5"
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-heading font-semibold text-sm">
              Live class
            </h4>
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
          {countdown && (
            <p className="mt-0.5 text-xs font-medium text-primary">{countdown}</p>
          )}
        </div>
        {showJoin && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors press shrink-0 ${
            live
              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
              : "bg-primary hover:bg-primary/90 text-primary-foreground"
          }`}
        >
          <Video className="h-4 w-4" />
          Join Live
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        )}
      </div>
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
    <div className="ml-3 mb-4">
      <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/60 dark:bg-violet-950/20 sm:flex-row sm:items-center">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-violet-700 dark:text-violet-300" />
            <h4 className="font-heading font-semibold text-sm">Quiz</h4>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Test your understanding — opens in a new tab.
          </p>
        </div>
        <a
          href={quizUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700 press shrink-0"
        >
          <ClipboardCheck className="h-4 w-4" />
          Take Quiz
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
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
    <div className="flex items-center gap-1 shrink-0">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleOpen}
        disabled={busy !== null}
        title={external ? "Open link in new tab" : "Open in new tab"}
      >
        {busy === "open" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ExternalLink className="h-3.5 w-3.5" />
        )}
      </Button>
      {!external && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDownload}
          disabled={busy !== null}
          title="Download"
        >
          {busy === "download" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}
