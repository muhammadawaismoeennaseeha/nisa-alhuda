"use client";

/**
 * Course Structure — the editable tab of the admin course workspace.
 *
 * Phases 0–2 shipped this as a read-only projection whose only affordance was a
 * link out to the instructor's subject screen. It now edits in place: subjects
 * add / rename / reorder / delete, and lessons add / edit / reorder / publish /
 * delete inside each subject.
 *
 * Every write goes through `@/lib/course-structure`, which the instructor
 * screen also uses — there is one definition of "save a lesson" in the
 * codebase, not two.
 *
 * ─── Recordings ────────────────────────────────────────────────────────────
 *
 * `lessons.recording_url` is the only copy of a class recording. Three rules
 * hold on this screen:
 *
 *   1. The row indicator stays a `<span>` — not a link, not a button. Nothing
 *      in the list opens, plays or reveals a recording URL.
 *   2. Edits save a column diff (`diffLesson`), so a patch that didn't touch
 *      the recording field doesn't name the column at all.
 *   3. Deleting a lesson that has a recording names it in the confirmation.
 *      Deleting a *subject* whose lessons have recordings is refused outright —
 *      `lessons.subject_id` is `ON DELETE CASCADE`, and a cascade is exactly
 *      the silent bulk loss this screen must not offer.
 *
 * Resources are unchanged: still a count here, still uploaded and deleted on
 * the subject screen, which each subject's "Open" link reaches.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Pencil,
  Plus,
  PlayCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  deleteLesson,
  deleteSubject,
  hasRecording,
  moveInOrder,
  persistOrder,
  updateLesson,
} from "@/lib/course-structure";
import { scheduleDisplayLabel } from "@/lib/recurring-schedule";
import {
  courseButton,
  courseButtonPrimary,
  courseCard,
  courseIconButton,
  courseTag,
  pillBase,
  pillTones,
} from "./course-surface";
import { CourseConfirmDialog } from "./course-confirm";
import { LessonDialog } from "./lesson-dialog";
import { SubjectDialog, type InstructorOption } from "./subject-dialog";
import type { Lesson, Subject } from "@/lib/types/database";

export type SubjectWithInstructor = Subject & {
  instructor?: { full_name: string | null } | null;
};

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

/** Which delete the confirmation dialog is currently asking about. */
type PendingDelete =
  | { kind: "lesson"; lesson: Lesson }
  | { kind: "subject"; subject: SubjectWithInstructor; lessons: Lesson[] };

export function CourseStructureEditor({
  offeringId,
  subjects: subjectsProp,
  lessons: lessonsProp,
  resourceCounts,
  instructors = [],
  defaultInstructorId = null,
}: {
  offeringId: string;
  subjects: SubjectWithInstructor[];
  lessons: Lesson[];
  resourceCounts: Record<string, number>;
  /** Candidates for a subject's required `instructor_id`. */
  instructors?: InstructorOption[];
  /** The course's own instructor, pre-selected when adding a subject. */
  defaultInstructorId?: string | null;
}) {
  const router = useRouter();

  // Reordering is optimistic — the arrows have to feel instant — so the order
  // lives in state and re-syncs whenever the server sends fresh rows.
  const [subjects, setSubjects] = useState(subjectsProp);
  const [lessons, setLessons] = useState(lessonsProp);
  useEffect(() => setSubjects(subjectsProp), [subjectsProp]);
  useEffect(() => setLessons(lessonsProp), [lessonsProp]);

  const [subjectDialog, setSubjectDialog] = useState<{
    open: boolean;
    subject: Subject | null;
  }>({ open: false, subject: null });

  const [lessonDialog, setLessonDialog] = useState<{
    open: boolean;
    subjectId: string | null;
    lesson: Lesson | null;
    nextSortOrder: number;
  }>({ open: false, subjectId: null, lesson: null, nextSortOrder: 0 });

  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const orphans = useMemo(
    () => lessons.filter((l) => !l.subject_id),
    [lessons]
  );
  const takenSlugs = useMemo(() => subjects.map((s) => s.slug), [subjects]);

  /** Lessons whose recording would be destroyed by deleting `subject`. */
  function recordingsUnder(subjectId: string): Lesson[] {
    return lessons.filter((l) => l.subject_id === subjectId && hasRecording(l));
  }

  async function moveSubject(index: number, direction: -1 | 1) {
    const next = moveInOrder(subjects, index, direction);
    if (next === subjects) return;
    const previous = subjects;
    setSubjects(next);
    try {
      await persistOrder(
        createClient(),
        "subjects",
        next.map((s) => s.id)
      );
      router.refresh();
    } catch {
      setSubjects(previous);
      toast.error("Failed to reorder subjects.");
    }
  }

  /**
   * Reorder within one subject's lessons.
   *
   * `sort_order` is renumbered 0..n-1 across that group only. The page sorts
   * every lesson by `sort_order` and then splits by subject, so a group's
   * internal order is all that's observable — groups can share numbers
   * harmlessly.
   */
  async function moveLesson(group: Lesson[], index: number, direction: -1 | 1) {
    const nextGroup = moveInOrder(group, index, direction);
    if (nextGroup === group) return;

    const previous = lessons;
    const byId = new Map(nextGroup.map((l, i) => [l.id, i]));
    // Rebuild the flat list so the group's rows appear in their new order.
    const reordered = lessons
      .map((l) => (byId.has(l.id) ? { ...l, sort_order: byId.get(l.id)! } : l))
      .sort((a, b) => a.sort_order - b.sort_order);
    setLessons(reordered);

    try {
      await persistOrder(
        createClient(),
        "lessons",
        nextGroup.map((l) => l.id)
      );
      router.refresh();
    } catch {
      setLessons(previous);
      toast.error("Failed to reorder classes.");
    }
  }

  async function togglePublish(lesson: Lesson) {
    setTogglingId(lesson.id);
    try {
      // A single-column patch: `recording_url` is not in it, so publishing a
      // class cannot disturb its recording.
      await updateLesson(createClient(), lesson.id, {
        is_published: !lesson.is_published,
      });
      toast.success(lesson.is_published ? "Class hidden" : "Class published");
      router.refresh();
    } catch {
      toast.error("Failed to update class.");
    } finally {
      setTogglingId(null);
    }
  }

  function requestDeleteSubject(subject: SubjectWithInstructor) {
    setPending({
      kind: "subject",
      subject,
      lessons: lessons.filter((l) => l.subject_id === subject.id),
    });
  }

  async function confirmDelete() {
    if (!pending) return;
    setDeleting(true);
    try {
      const supabase = createClient();
      if (pending.kind === "lesson") {
        await deleteLesson(supabase, pending.lesson.id);
        toast.success("Class deleted.");
      } else {
        await deleteSubject(supabase, pending.subject.id);
        toast.success("Subject deleted.");
      }
      setPending(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete."
      );
    } finally {
      setDeleting(false);
    }
  }

  const blockedRecordings =
    pending?.kind === "subject" ? recordingsUnder(pending.subject.id) : [];

  return (
    <div className="space-y-3">
      {subjects.length === 0 && orphans.length === 0 ? (
        <div
          className={cn(
            courseCard,
            "flex flex-col items-center justify-center px-6 py-12 text-center"
          )}
        >
          <Layers className="mb-4 h-10 w-10 text-rose-200 dark:text-rose-900" />
          <p className="mb-1.5 text-base text-muted-foreground">
            No subjects yet
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            Add a subject to start building this course.
          </p>
          <button
            type="button"
            className={cn(courseButtonPrimary, "cursor-pointer")}
            onClick={() => setSubjectDialog({ open: true, subject: null })}
          >
            <Plus className="h-4 w-4" />
            Add subject
          </button>
        </div>
      ) : (
        subjects.map((subject, i) => {
          const group = lessons.filter((l) => l.subject_id === subject.id);
          return (
            <SubjectBlock
              key={subject.id}
              index={i}
              total={subjects.length}
              subject={subject}
              lessons={group}
              resourceCounts={resourceCounts}
              togglingId={togglingId}
              onMove={(dir) => moveSubject(i, dir)}
              onEdit={() => setSubjectDialog({ open: true, subject })}
              onDelete={() => requestDeleteSubject(subject)}
              onAddLesson={() =>
                setLessonDialog({
                  open: true,
                  subjectId: subject.id,
                  lesson: null,
                  nextSortOrder: group.length,
                })
              }
              onEditLesson={(lesson) =>
                setLessonDialog({
                  open: true,
                  subjectId: subject.id,
                  lesson,
                  nextSortOrder: group.length,
                })
              }
              onDeleteLesson={(lesson) => setPending({ kind: "lesson", lesson })}
              onTogglePublish={togglePublish}
              onMoveLesson={(idx, dir) => moveLesson(group, idx, dir)}
            />
          );
        })
      )}

      {orphans.length > 0 && (
        <div className={courseCard}>
          <div className="px-[18px] py-4">
            <h3 className="font-heading flex items-center gap-2 text-[15px] font-bold">
              Unassigned lessons
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Lessons on this course that aren&apos;t attached to a subject.
              Edit one to correct it.
            </p>
          </div>
          <LessonRows
            lessons={orphans}
            resourceCounts={resourceCounts}
            togglingId={togglingId}
            onEdit={(lesson) =>
              setLessonDialog({
                open: true,
                subjectId: null,
                lesson,
                nextSortOrder: orphans.length,
              })
            }
            onDelete={(lesson) => setPending({ kind: "lesson", lesson })}
            onTogglePublish={togglePublish}
            onMove={(idx, dir) => moveLesson(orphans, idx, dir)}
          />
        </div>
      )}

      <div className="flex items-start gap-3 rounded-[var(--radius)] border border-sage-200 bg-sage-50 px-[18px] py-3.5 dark:border-emerald-900 dark:bg-emerald-950/30">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sage-700 dark:text-emerald-300" />
        <p className="text-[13px] text-sage-700 dark:text-emerald-200">
          <strong className="font-semibold">Recordings protected.</strong> Every
          save here writes only the fields you changed, so editing a class never
          touches its recording link. Replacing one takes a deliberate unlock,
          deleting a class that has one asks first, and a subject holding
          recordings can&apos;t be deleted in bulk.
        </p>
      </div>

      {subjects.length > 0 && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={cn(courseButtonPrimary, "cursor-pointer")}
            onClick={() => setSubjectDialog({ open: true, subject: null })}
          >
            <Plus className="h-4 w-4" />
            Add subject
          </button>
        </div>
      )}

      {subjectDialog.open && (
        <SubjectDialog
          // Remounting per target resets the form to that subject's values —
          // the dialog seeds its state from props on mount.
          key={subjectDialog.subject?.id ?? "new-subject"}
          open
          onOpenChange={(open) =>
            !open && setSubjectDialog({ open: false, subject: null })
          }
          offeringId={offeringId}
          subject={subjectDialog.subject}
          takenSlugs={takenSlugs}
          nextSortOrder={subjects.length}
          instructors={instructors}
          defaultInstructorId={defaultInstructorId}
          onSaved={() => router.refresh()}
        />
      )}

      {lessonDialog.open && (
        <LessonDialog
          key={lessonDialog.lesson?.id ?? `new-lesson-${lessonDialog.subjectId}`}
          open
          onOpenChange={(open) =>
            !open &&
            setLessonDialog({
              open: false,
              subjectId: null,
              lesson: null,
              nextSortOrder: 0,
            })
          }
          offeringId={offeringId}
          subjectId={lessonDialog.subjectId}
          lesson={lessonDialog.lesson}
          nextSortOrder={lessonDialog.nextSortOrder}
          onSaved={() => router.refresh()}
        />
      )}

      {pending?.kind === "lesson" && (
        <CourseConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title="Delete this class?"
          confirmLabel={
            hasRecording(pending.lesson)
              ? "Delete class and its recording"
              : "Delete class"
          }
          onConfirm={confirmDelete}
          busy={deleting}
        >
          <p>
            <strong className="text-foreground">
              &ldquo;{pending.lesson.title}&rdquo;
            </strong>{" "}
            and its attached resources will be deleted. This cannot be undone.
          </p>
          {hasRecording(pending.lesson) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-semibold">
                This class has a recording. It will be lost.
              </p>
              <p className="mt-1 break-all">{pending.lesson.recording_url}</p>
              <p className="mt-1">
                Nisa stores no second copy of this link. Save it somewhere first
                if students still need it.
              </p>
            </div>
          )}
        </CourseConfirmDialog>
      )}

      {pending?.kind === "subject" && (
        <CourseConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={
            blockedRecordings.length > 0
              ? "This subject holds recordings"
              : "Delete this subject?"
          }
          confirmLabel="Delete subject"
          onConfirm={confirmDelete}
          busy={deleting}
          blocked={blockedRecordings.length > 0}
        >
          {blockedRecordings.length > 0 ? (
            <>
              <p>
                <strong className="text-foreground">
                  &ldquo;{pending.subject.title}&rdquo;
                </strong>{" "}
                can&apos;t be deleted from here:{" "}
                {plural(blockedRecordings.length, "class", "classes")} under it
                still {blockedRecordings.length === 1 ? "has" : "have"} a
                recording, and deleting the subject would take{" "}
                {blockedRecordings.length === 1 ? "it" : "them"} too.
              </p>
              <ul className="list-inside list-disc space-y-1">
                {blockedRecordings.map((l) => (
                  <li key={l.id} className="text-foreground">
                    {l.title}
                  </li>
                ))}
              </ul>
              <p>
                Delete those classes one at a time first — each asks separately
                and names the recording it is about to lose.
              </p>
            </>
          ) : (
            <p>
              <strong className="text-foreground">
                &ldquo;{pending.subject.title}&rdquo;
              </strong>
              {pending.lessons.length === 0 ? (
                <> is empty and will be deleted. This cannot be undone.</>
              ) : (
                <>
                  {" "}
                  will be deleted along with{" "}
                  {plural(pending.lessons.length, "class", "classes")} and their
                  resources. None of them has a recording. This cannot be
                  undone.
                </>
              )}
            </p>
          )}
        </CourseConfirmDialog>
      )}
    </div>
  );
}

/* ── Subject card ─────────────────────────────────────────────────────── */

function SubjectBlock({
  index,
  total,
  subject,
  lessons,
  resourceCounts,
  togglingId,
  onMove,
  onEdit,
  onDelete,
  onAddLesson,
  onEditLesson,
  onDeleteLesson,
  onTogglePublish,
  onMoveLesson,
}: {
  index: number;
  total: number;
  subject: SubjectWithInstructor;
  lessons: Lesson[];
  resourceCounts: Record<string, number>;
  togglingId: string | null;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddLesson: () => void;
  onEditLesson: (lesson: Lesson) => void;
  onDeleteLesson: (lesson: Lesson) => void;
  onTogglePublish: (lesson: Lesson) => void;
  onMoveLesson: (index: number, direction: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(true);
  const scheduleLabel = scheduleDisplayLabel(subject);
  const recordings = lessons.filter(hasRecording).length;

  const meta = [
    plural(lessons.length, "lesson"),
    plural(recordings, "recording"),
    subject.instructor?.full_name,
    scheduleLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={courseCard}>
      <div className="flex flex-wrap items-center gap-2 px-[18px] py-[15px]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="font-heading block text-[15px] font-semibold">
              <span className="text-rose-500 dark:text-rose-300">
                {index + 1}
              </span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span>{subject.title}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {meta}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90"
            )}
          />
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={courseIconButton}
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Move ${subject.title} up`}
            title="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={courseIconButton}
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`Move ${subject.title} down`}
            title="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={courseIconButton}
            onClick={onEdit}
            aria-label={`Edit ${subject.title}`}
            title="Edit subject"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(
              courseIconButton,
              "hover:border-[#E4A9A9] hover:bg-[#FBEEEE] hover:text-[#9A3D3D] dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            )}
            onClick={onDelete}
            aria-label={`Delete ${subject.title}`}
            title="Delete subject"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <Link
            href={`/dashboard/instructor/subjects/${subject.id}`}
            className="ml-1 shrink-0 text-[13px] font-semibold text-rose-700 hover:underline dark:text-rose-300"
          >
            Open
          </Link>
        </div>
      </div>

      {open && (
        <>
          {lessons.length === 0 ? (
            <p className="border-t border-border-soft px-[18px] py-5 text-center text-sm text-muted-foreground dark:border-border">
              No lessons in this subject yet.
            </p>
          ) : (
            <LessonRows
              lessons={lessons}
              resourceCounts={resourceCounts}
              togglingId={togglingId}
              onEdit={onEditLesson}
              onDelete={onDeleteLesson}
              onTogglePublish={onTogglePublish}
              onMove={onMoveLesson}
            />
          )}
          <div className="border-t border-border-soft px-[18px] py-3 dark:border-border">
            <button
              type="button"
              className={cn(courseButton, "cursor-pointer")}
              onClick={onAddLesson}
            >
              <Plus className="h-4 w-4" />
              Add class
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Lesson rows ──────────────────────────────────────────────────────── */

function LessonRows({
  lessons,
  resourceCounts,
  togglingId,
  onEdit,
  onDelete,
  onTogglePublish,
  onMove,
}: {
  lessons: Lesson[];
  resourceCounts: Record<string, number>;
  togglingId: string | null;
  onEdit: (lesson: Lesson) => void;
  onDelete: (lesson: Lesson) => void;
  onTogglePublish: (lesson: Lesson) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  return (
    <ul className="border-t border-border-soft dark:border-border">
      {lessons.map((lesson, i) => {
        const resources = resourceCounts[lesson.id] ?? 0;
        const meta = [
          lesson.scheduled_at ? formatDate(lesson.scheduled_at) : null,
          lesson.is_published ? null : "draft",
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <li
            key={lesson.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-soft px-[18px] py-3 first:border-t-0 dark:border-border"
          >
            <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-rose-50 text-xs font-bold text-rose-600 tabular-nums dark:bg-rose-950/50 dark:text-rose-300">
              {i + 1}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">
                {lesson.title}
              </span>
              {meta && (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {meta}
                </span>
              )}
            </span>

            {/*
              Read-only indicator, not a control. Keep this a <span>: turning it
              into a link or a button would put a path to a recording_url on a
              list that must never offer one. Changing a recording is a
              deliberate unlock inside the edit dialog, nowhere else.
            */}
            {hasRecording(lesson) && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
                <PlayCircle className="h-3 w-3" />
                Recording
              </span>
            )}

            {resources > 0 && (
              <span className={courseTag}>
                {resources} {resources === 1 ? "resource" : "resources"}
              </span>
            )}

            {lesson.live_class_link && (
              <span className={courseTag}>Live link</span>
            )}

            {!lesson.is_published && (
              <span className={cn(pillBase, pillTones.muted)}>Draft</span>
            )}

            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className={courseIconButton}
                onClick={() => onMove(i, -1)}
                disabled={i === 0}
                aria-label={`Move ${lesson.title} up`}
                title="Move up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={courseIconButton}
                onClick={() => onMove(i, 1)}
                disabled={i === lessons.length - 1}
                aria-label={`Move ${lesson.title} down`}
                title="Move down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={courseIconButton}
                onClick={() => onTogglePublish(lesson)}
                disabled={togglingId === lesson.id}
                aria-label={
                  lesson.is_published
                    ? `Hide ${lesson.title} from students`
                    : `Publish ${lesson.title}`
                }
                title={lesson.is_published ? "Hide from students" : "Publish"}
              >
                {togglingId === lesson.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : lesson.is_published ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                className={courseIconButton}
                onClick={() => onEdit(lesson)}
                aria-label={`Edit ${lesson.title}`}
                title="Edit class"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(
                  courseIconButton,
                  "hover:border-[#E4A9A9] hover:bg-[#FBEEEE] hover:text-[#9A3D3D] dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                )}
                onClick={() => onDelete(lesson)}
                aria-label={`Delete ${lesson.title}`}
                title="Delete class"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
