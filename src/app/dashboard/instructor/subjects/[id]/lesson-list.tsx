/**
 * Class List — the per-subject folder view.
 *
 * Shows every "Class" (a `lessons` row) for this subject as an expandable
 * card. Each card surfaces:
 *   - Status (Upcoming / Live now / Recorded / Past, no recording)
 *   - Live class link (Join button while live or upcoming)
 *   - Recording link (Watch button when set)
 *   - Inline resource list with upload/delete inside the expanded card
 *   - Edit / Delete / Publish-toggle controls
 *
 * Replaces the previous flat lesson list + the standalone Resources page
 * (which is gone from primary nav). One screen, one mental model.
 *
 * ─── Presentation ──────────────────────────────────────────────────────────
 *
 * Re-skinned onto the shared course surface (`@/components/course/*`): rose
 * numbered squares lead each class, status is a pill from `pillTones`, and the
 * per-row controls are the same 28px icon buttons the admin structure editor
 * uses. Nothing about how a class is created, edited, published or deleted
 * changed with the skin.
 *
 * ─── Recordings ────────────────────────────────────────────────────────────
 *
 * `lessons.recording_url` is the only copy of a class recording. This screen:
 *   - never writes it — the publish toggle sends `{ is_published }` alone, and
 *     the edit path is `LessonForm`, which locks an existing recording behind a
 *     deliberate "Replace";
 *   - still offers both watch affordances it always did (a `target="_blank"`
 *     anchor for non-YouTube URLs, the lazy `RecordingPlayer` for YouTube);
 *   - names the recording in the delete confirmation, as the admin editor does,
 *     so no one loses one to a reflexive "OK".
 */
"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Video,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Calendar,
  ExternalLink,
  ChevronDown,
  Upload,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  Radio,
  PlayCircle,
  Clock,
  Download,
  Link2,
  Globe,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  courseButton,
  courseButtonDanger,
  courseButtonPrimary,
  courseCard,
  courseIconButton,
  courseTag,
  iconTints,
  pillBase,
  pillTones,
  type PillTone,
} from "@/components/course/course-surface";
import { CourseConfirmDialog } from "@/components/course/course-confirm";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { LessonForm } from "./lesson-form";
import { deleteLesson, hasRecording, updateLesson } from "@/lib/course-structure";
import { partitionLessons, isExternalUrl } from "@/lib/resource-helpers";
import { RecordingPlayer } from "@/components/lesson/recording-player";
import { isYouTubeUrl } from "@/lib/video-helpers";
import type { Lesson, Resource } from "@/lib/types/database";

interface LessonListProps {
  subjectId: string;
  offeringId: string;
  lessons: Lesson[];
  initialResources: Resource[];
  /**
   * Subject-level recurring meeting URL (migration 024). Used as a
   * fallback when a lesson row has no per-row `live_class_link` — the
   * new pattern is one URL per subject, applied to every weekly class.
   */
  subjectRecurringMeetingUrl?: string | null;
}

/** The hairline that separates rows inside a course card. */
const HAIRLINE = "border-border-soft dark:border-border";

/** The uppercase section label above Resources / Classes. */
const SECTION_LABEL =
  "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";

/** The drop zone, in its resting and drag-over states. */
const DROP_ZONE =
  "mb-3 cursor-pointer rounded-[10px] border-2 border-dashed p-3 text-center transition-colors";
const DROP_ZONE_IDLE =
  "border-border-soft hover:border-rose-300 hover:bg-rose-50/50 dark:border-border dark:hover:bg-rose-950/20";
const DROP_ZONE_OVER = "border-rose-400 bg-rose-50 dark:bg-rose-950/30";

const GLYPH = "h-4 w-4";

/**
 * Resource glyphs, stored as elements rather than component references: a
 * `const Icon = MAP[ext]` in a component body reads to the linter as a
 * component defined during render.
 */
const FILE_GLYPHS: Record<string, React.ReactNode> = {
  pdf: <FileText className={GLYPH} />,
  doc: <FileText className={GLYPH} />,
  docx: <FileText className={GLYPH} />,
  txt: <FileText className={GLYPH} />,
  png: <ImageIcon className={GLYPH} />,
  jpg: <ImageIcon className={GLYPH} />,
  jpeg: <ImageIcon className={GLYPH} />,
  webp: <ImageIcon className={GLYPH} />,
};

/** A globe for an external link, otherwise the glyph for the file extension. */
function resourceGlyph(resource: Resource): React.ReactNode {
  if (isExternalUrl(resource.file_url)) return <Globe className={GLYPH} />;
  const ext = resource.title.split(".").pop()?.toLowerCase() || "";
  return FILE_GLYPHS[ext] ?? <FileIcon className={GLYPH} />;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ClassStatus = {
  kind: "live" | "upcoming" | "recorded" | "missing-rec" | "draft";
  label: string;
  tone: PillTone;
  icon: typeof Calendar;
};

function getClassStatus(lesson: Lesson): ClassStatus {
  if (!lesson.scheduled_at) {
    return { kind: "draft", label: "Draft", tone: "muted", icon: Calendar };
  }
  const now = Date.now();
  const start = new Date(lesson.scheduled_at).getTime();
  // Treat a class as "live" within a generous 2-hour window from start
  // unless it already has a recording (then it's clearly done).
  const liveWindowEnd = start + 2 * 60 * 60 * 1000;
  if (now >= start && now <= liveWindowEnd && !lesson.recording_url) {
    return { kind: "live", label: "Live now", tone: "success", icon: Radio };
  }
  if (now < start) {
    const diff = start - now;
    const mins = Math.round(diff / 60000);
    let label: string;
    if (mins < 60) label = `Starts in ${mins}m`;
    else if (mins < 60 * 24) label = `Starts in ${Math.round(mins / 60)}h`;
    else label = `In ${Math.round(mins / (60 * 24))}d`;
    return { kind: "upcoming", label, tone: "steel", icon: Clock };
  }
  if (lesson.recording_url) {
    return {
      kind: "recorded",
      label: "Recorded",
      tone: "brand",
      icon: PlayCircle,
    };
  }
  return {
    kind: "missing-rec",
    label: "No recording yet",
    tone: "warning",
    icon: Clock,
  };
}

export function LessonList({
  subjectId,
  offeringId,
  lessons: initialLessons,
  initialResources,
  subjectRecurringMeetingUrl,
}: LessonListProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Lesson | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>(initialResources);

  function handleAddNew() {
    setEditingLesson(null);
    setShowForm(true);
  }

  function handleEdit(lesson: Lesson) {
    setEditingLesson(lesson);
    setShowForm(true);
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingLesson(null);
    router.refresh();
  }

  async function handleTogglePublish(lesson: Lesson) {
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

  async function confirmDeleteClass() {
    if (!pendingDelete) return;
    const lessonId = pendingDelete.id;
    setDeletingId(lessonId);
    try {
      await deleteLesson(createClient(), lessonId);
      toast.success("Class deleted.");
      setPendingDelete(null);
      router.refresh();
    } catch {
      toast.error("Failed to delete class.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteResource(resource: Resource) {
    if (!confirm(`Delete "${resource.title}"?`)) return;
    try {
      const supabase = createClient();
      await supabase.storage.from("resources").remove([resource.file_url]);
      const { error } = await supabase
        .from("resources")
        .delete()
        .eq("id", resource.id);
      if (error) throw error;
      setResources((prev) => prev.filter((r) => r.id !== resource.id));
      toast.success("Resource deleted.");
    } catch {
      toast.error("Failed to delete resource.");
    }
  }

  const handleAddLink = useCallback(
    async (lessonId: string, title: string, url: string) => {
      const trimmedTitle = title.trim();
      const trimmedUrl = url.trim();
      if (!trimmedTitle || !trimmedUrl) {
        toast.error("Both title and URL are required.");
        return false;
      }
      if (!/^https?:\/\//i.test(trimmedUrl)) {
        toast.error("URL must start with https:// or http://.");
        return false;
      }
      try {
        const supabase = createClient();
        const { data: row, error } = await supabase
          .from("resources")
          .insert({
            lesson_id: lessonId,
            title: trimmedTitle,
            // file_url stores the full URL — isExternalUrl() detects it
            // on read and skips storage signing.
            file_url: trimmedUrl,
            file_type: "link",
            file_size: 0,
          })
          .select()
          .single();
        if (error) throw error;
        if (row) setResources((prev) => [row as Resource, ...prev]);
        toast.success(`Added link: ${trimmedTitle}`);
        return true;
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Failed to add link."
        );
        return false;
      }
    },
    []
  );

  const handleUpload = useCallback(
    async (lessonId: string, files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;
      const MAX_SIZE = 10 * 1024 * 1024;
      const oversized = fileArray.filter((f) => f.size > MAX_SIZE);
      if (oversized.length > 0) {
        toast.error(`File(s) exceed 10MB: ${oversized.map((f) => f.name).join(", ")}`);
        return;
      }

      const supabase = createClient();
      for (const file of fileArray) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
        const storagePath = `${lessonId}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("resources")
          .upload(storagePath, file);
        if (uploadError) {
          toast.error(`Upload failed: ${file.name} — ${uploadError.message}`);
          continue;
        }

        const { data: row, error: insertError } = await supabase
          .from("resources")
          .insert({
            lesson_id: lessonId,
            title: file.name,
            file_url: storagePath,
            file_type: ext,
            file_size: file.size,
          })
          .select()
          .single();

        if (insertError) {
          await supabase.storage.from("resources").remove([storagePath]);
          toast.error(`Save failed: ${file.name}`);
          continue;
        }
        if (row) {
          setResources((prev) => [row as Resource, ...prev]);
        }
        toast.success(`Uploaded ${file.name}`);
      }
    },
    []
  );

  if (showForm) {
    return (
      <LessonForm
        subjectId={subjectId}
        offeringId={offeringId}
        lesson={editingLesson}
        nextSortOrder={initialLessons.length + 1}
        onClose={handleFormClose}
      />
    );
  }

  // Lessons with no schedule/no live link are "Resources" holders, not
  // actual classes. We surface their attached files in a Resources block
  // at the top of the page rather than as Class cards.
  const { resourceLessons, classLessons } = partitionLessons(initialLessons);
  const resourceLessonIds = new Set(resourceLessons.map((l) => l.id));
  const subjectResources = resources.filter((r) =>
    resourceLessonIds.has(r.lesson_id)
  );

  return (
    <div className="space-y-5">
      {/* Subject-level Resources */}
      {(resourceLessons.length > 0 || subjectResources.length > 0) && (
        <ResourcesSection
          resources={subjectResources}
          /* All resources upload into the FIRST resource-holding lesson by
             default; if none exists we tell the user to create one via
             the form. */
          uploadLessonId={resourceLessons[0]?.id ?? null}
          onUpload={(files) =>
            resourceLessons[0] && handleUpload(resourceLessons[0].id, files)
          }
          onAddLink={(title, url) =>
            resourceLessons[0]
              ? handleAddLink(resourceLessons[0].id, title, url)
              : Promise.resolve(false)
          }
          onDeleteResource={handleDeleteResource}
        />
      )}

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-heading text-[15px] font-bold">
            Classes ({classLessons.length})
          </h2>
          <button
            type="button"
            onClick={handleAddNew}
            className={cn(courseButtonPrimary, "press cursor-pointer")}
          >
            <Plus className="h-4 w-4" />
            Add Class
          </button>
        </div>

        {classLessons.length === 0 ? (
          <div
            className={cn(
              courseCard,
              "flex flex-col items-center justify-center px-6 py-12 text-center"
            )}
          >
            <Video className="mb-4 h-10 w-10 text-rose-200 dark:text-rose-900" />
            <p className="mb-1.5 text-base text-muted-foreground">
              No classes yet
            </p>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              Add the first class — name it by date (e.g. &ldquo;27 Apr
              2026&rdquo;) or by topic (e.g. &ldquo;Surah Al-Fatihah —
              Tafseer&rdquo;). You can include the live link, recording, and
              resource files.
            </p>
            <button
              type="button"
              onClick={handleAddNew}
              className={cn(courseButtonPrimary, "cursor-pointer")}
            >
              <Plus className="h-4 w-4" />
              Add First Class
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {classLessons.map((lesson, idx) => {
              const isExpanded = expandedId === lesson.id;
              const status = getClassStatus(lesson);
              const StatusIcon = status.icon;
              const lessonResources = resources.filter(
                (r) => r.lesson_id === lesson.id
              );
              return (
                <ClassCard
                  key={lesson.id}
                  lesson={lesson}
                  idx={idx}
                  isExpanded={isExpanded}
                  onToggle={() => setExpandedId(isExpanded ? null : lesson.id)}
                  status={status}
                  StatusIcon={StatusIcon}
                  resources={lessonResources}
                  onEdit={() => handleEdit(lesson)}
                  onDelete={() => setPendingDelete(lesson)}
                  onTogglePublish={() => handleTogglePublish(lesson)}
                  deletingId={deletingId}
                  togglingId={togglingId}
                  onUpload={(files) => handleUpload(lesson.id, files)}
                  onDeleteResource={handleDeleteResource}
                  subjectRecurringMeetingUrl={subjectRecurringMeetingUrl}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation — names the recording it is about to lose, the
          same way the admin structure editor does. */}
      {pendingDelete && (
        <CourseConfirmDialog
          open
          onOpenChange={(open) => !open && setPendingDelete(null)}
          title="Delete this class?"
          confirmLabel={
            hasRecording(pendingDelete)
              ? "Delete class and its recording"
              : "Delete class"
          }
          onConfirm={confirmDeleteClass}
          busy={deletingId === pendingDelete.id}
        >
          <p>
            <strong className="text-foreground">
              &ldquo;{pendingDelete.title}&rdquo;
            </strong>{" "}
            and its attached resources will be deleted. This cannot be undone.
          </p>
          {hasRecording(pendingDelete) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-semibold">
                This class has a recording. It will be lost.
              </p>
              <p className="mt-1 break-all">{pendingDelete.recording_url}</p>
              <p className="mt-1">
                Nisa stores no second copy of this link. Save it somewhere first
                if students still need it.
              </p>
            </div>
          )}
        </CourseConfirmDialog>
      )}
    </div>
  );
}

// ─── Class Card ────────────────────────────────────────────

interface ClassCardProps {
  lesson: Lesson;
  idx: number;
  isExpanded: boolean;
  onToggle: () => void;
  status: ClassStatus;
  StatusIcon: typeof Calendar;
  resources: Resource[];
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublish: () => void;
  deletingId: string | null;
  togglingId: string | null;
  onUpload: (files: FileList | File[]) => void;
  onDeleteResource: (r: Resource) => void;
  /** Falls back as the join URL when the lesson row has none. */
  subjectRecurringMeetingUrl?: string | null;
}

function ClassCard({
  lesson,
  idx,
  isExpanded,
  onToggle,
  status,
  StatusIcon,
  resources,
  onEdit,
  onDelete,
  onTogglePublish,
  deletingId,
  togglingId,
  onUpload,
  onDeleteResource,
  subjectRecurringMeetingUrl,
}: ClassCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className={cn(courseCard, !lesson.is_published && "opacity-80")}>
      {/* Header row — clickable to expand */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full cursor-pointer px-[18px] py-[15px] text-left"
      >
        <div className="flex items-start gap-3">
          {/* The mockup's numbered square. */}
          <span className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-rose-50 text-xs font-bold text-rose-600 tabular-nums dark:bg-rose-950/50 dark:text-rose-300">
            {idx + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="font-heading truncate text-[15px] font-semibold">
                {lesson.title}
              </h3>
              <span
                className={cn(
                  pillBase,
                  pillTones[status.tone],
                  "inline-flex items-center gap-1"
                )}
              >
                <StatusIcon className="h-3 w-3" />
                {status.label}
              </span>
              {!lesson.is_published && (
                <span className={cn(pillBase, pillTones.muted)}>Hidden</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {lesson.scheduled_at && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(lesson.scheduled_at).toLocaleString("en-PK", {
                    timeZone: "Asia/Karachi",
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  PKT
                </span>
              )}
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {resources.length} resource
                {resources.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <ChevronDown
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              !isExpanded && "-rotate-90"
            )}
          />
        </div>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className={cn("border-t px-[18px] pb-4", HAIRLINE)}>
          {/* Action row — live link / recording / edit / publish / delete */}
          <div className="mb-4 flex flex-wrap items-center gap-2 pt-3.5">
            {(() => {
              // Effective join URL: per-lesson live_class_link wins, else
              // subject's recurring URL is the fallback.
              const joinUrl =
                lesson.live_class_link ?? subjectRecurringMeetingUrl ?? null;
              return joinUrl ? (
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    courseButtonPrimary,
                    "border-sage-700 bg-sage-700 hover:border-sage-700/90 hover:bg-sage-700/90 dark:border-emerald-700 dark:bg-emerald-700"
                  )}
                >
                  <Radio className="h-3.5 w-3.5" />
                  Join live class
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className={courseTag}>No live link set</span>
              );
            })()}

            {/* Recording link — pill button only when URL is set AND
                not a YouTube URL. YouTube URLs render as a collapsible
                embed in a separate row below. */}
            {lesson.recording_url && !isYouTubeUrl(lesson.recording_url) && (
              <a
                href={lesson.recording_url}
                target="_blank"
                rel="noreferrer"
                className={courseButton}
              >
                <PlayCircle className="h-3.5 w-3.5" />
                Watch recording
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {!lesson.recording_url && (
              <span className={courseTag}>No recording yet</span>
            )}

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className={courseIconButton}
                onClick={onTogglePublish}
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
                onClick={onEdit}
                aria-label={`Edit ${lesson.title}`}
                title="Edit class"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(courseIconButton, courseButtonDanger)}
                onClick={onDelete}
                disabled={deletingId === lesson.id}
                aria-label={`Delete ${lesson.title}`}
                title="Delete class"
              >
                {deletingId === lesson.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Collapsible YouTube embed — full-width row below the
              action buttons. Iframe is mounted lazily on click so the
              URL never leaks into the initial DOM. */}
          {lesson.recording_url && isYouTubeUrl(lesson.recording_url) && (
            <div className="mb-4">
              <RecordingPlayer url={lesson.recording_url} />
            </div>
          )}

          {/* Description */}
          {lesson.description && (
            <p className="mb-4 text-sm whitespace-pre-line text-muted-foreground">
              {lesson.description}
            </p>
          )}

          {/* Resources section */}
          <div>
            <h4 className={cn(SECTION_LABEL, "mb-2")}>
              <FileText className="h-3.5 w-3.5 text-rose-500 dark:text-rose-300" />
              Resources
            </h4>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files.length > 0) {
                  onUpload(e.dataTransfer.files);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                DROP_ZONE,
                dragOver ? DROP_ZONE_OVER : DROP_ZONE_IDLE
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.pptx,.xlsx,.mp3,.mp4"
                onChange={(e) => {
                  if (e.target.files) onUpload(e.target.files);
                  e.target.value = "";
                }}
              />
              <div className="flex items-center justify-center gap-2 text-sm">
                <Upload className="h-4 w-4 text-rose-500 dark:text-rose-300" />
                <span>
                  Drop files here or{" "}
                  <span className="font-medium text-rose-700 dark:text-rose-300">
                    browse
                  </span>{" "}
                  · max 10MB each
                </span>
              </div>
            </div>

            {resources.length > 0 ? (
              <div className="space-y-2">
                {resources.map((r) => (
                  <ResourceRow
                    key={r.id}
                    resource={r}
                    onDelete={() => onDeleteResource(r)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No resources uploaded yet.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Resource row ───────────────────────────────────────────

function ResourceRow({
  resource,
  onDelete,
}: {
  resource: Resource;
  onDelete: () => void;
}) {
  const isLink = isExternalUrl(resource.file_url);
  return (
    <div
      className={cn("flex items-center gap-3 rounded-[10px] border p-2.5", HAIRLINE)}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          iconTints.brand
        )}
      >
        {resourceGlyph(resource)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{resource.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {isLink ? (
            <>
              <span className="font-medium text-rose-700 dark:text-rose-300">
                External link
              </span>{" "}
              · {new URL(resource.file_url).hostname}
            </>
          ) : (
            <>
              {formatFileSize(resource.file_size)} ·{" "}
              <span className="uppercase">{resource.file_type}</span>
            </>
          )}
        </p>
      </div>
      <ResourceLink path={resource.file_url} fileName={resource.title} />
      <button
        type="button"
        className={cn(courseIconButton, courseButtonDanger, "shrink-0")}
        onClick={onDelete}
        aria-label={`Delete ${resource.title}`}
        title="Delete resource"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── ResourceLink: signs a private storage URL on click ─────────

function ResourceLink({ path, fileName }: { path: string; fileName?: string }) {
  const [busy, setBusy] = useState<"open" | "download" | null>(null);
  const external = isExternalUrl(path);

  async function getUrl(forDownload: boolean): Promise<string | null> {
    // External URL (e.g. Google Drive): just hand it back — Drive
    // handles its own preview/download dance, and the URL has no
    // expiry to worry about.
    if (external) return path;
    const supabase = createClient();
    const opts = forDownload
      ? { download: fileName || true }
      : undefined;
    const { data, error } = await supabase.storage
      .from("resources")
      .createSignedUrl(path, 60 * 10, opts);
    if (error || !data?.signedUrl) {
      toast.error("Could not get this file.");
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
      // Browser-native download via a hidden <a download>: the signed URL
      // already carries Content-Disposition: attachment, but we also set
      // the link's `download` attribute so it works on stricter browsers.
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "";
      // External link → open in a new tab (no inline download), so the
      // browser/Drive can show its own viewer.
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

// ─── Subject-level Resources block ───────────────────────────

interface ResourcesSectionProps {
  resources: Resource[];
  uploadLessonId: string | null;
  onUpload: (files: FileList | File[]) => void;
  /** Resolves true when the link was added successfully so the form can clear. */
  onAddLink: (title: string, url: string) => Promise<boolean>;
  onDeleteResource: (r: Resource) => void;
}

function ResourcesSection({
  resources,
  uploadLessonId,
  onUpload,
  onAddLink,
  onDeleteResource,
}: ResourcesSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [savingLink, setSavingLink] = useState(false);

  async function submitLink(e: React.FormEvent) {
    e.preventDefault();
    setSavingLink(true);
    const ok = await onAddLink(linkTitle, linkUrl);
    setSavingLink(false);
    if (ok) {
      setLinkTitle("");
      setLinkUrl("");
      setShowLinkForm(false);
    }
  }

  return (
    <div>
      <h2 className="font-heading mb-3 flex items-center gap-2 text-[15px] font-bold">
        <FileText className="h-4 w-4 text-rose-500 dark:text-rose-300" />
        Resources
        {resources.length > 0 && (
          <span className="text-sm font-normal text-muted-foreground">
            ({resources.length})
          </span>
        )}
      </h2>

      <div className={cn(courseCard, "p-4")}>
        {/* Upload zone — only enabled when a holder lesson exists */}
        {uploadLessonId ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) {
                onUpload(e.dataTransfer.files);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(DROP_ZONE, dragOver ? DROP_ZONE_OVER : DROP_ZONE_IDLE)}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.pptx,.xlsx,.mp3,.mp4"
              onChange={(e) => {
                if (e.target.files) onUpload(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="flex items-center justify-center gap-2 text-sm">
              <Upload className="h-4 w-4 text-rose-500 dark:text-rose-300" />
              <span>
                Drop files here or{" "}
                <span className="font-medium text-rose-700 dark:text-rose-300">
                  browse
                </span>{" "}
                · max 50MB each · students can download
              </span>
            </div>
          </div>
        ) : null}

        {/* Add link — for files too big for Storage (e.g. Drive PDFs). */}
        {uploadLessonId ? (
          showLinkForm ? (
            <form
              onSubmit={submitLink}
              className={cn(
                "mb-3 space-y-2 rounded-[10px] border bg-rose-50/40 p-3 dark:bg-rose-950/20",
                HAIRLINE
              )}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Link2 className="h-4 w-4 text-rose-500 dark:text-rose-300" />
                Add an external link
              </div>
              <Input
                placeholder="Title (e.g. Tafseer Ibn Kathir — English)"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                required
              />
              <Input
                type="url"
                placeholder="https://drive.google.com/..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                required
              />
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  className={cn(courseButton, "cursor-pointer")}
                  onClick={() => {
                    setShowLinkForm(false);
                    setLinkTitle("");
                    setLinkUrl("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingLink}
                  className={cn(
                    courseButtonPrimary,
                    "cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  )}
                >
                  {savingLink ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Adding…
                    </>
                  ) : (
                    "Add link"
                  )}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Tip: paste a Google Drive share link (set the file&apos;s
                visibility to <em>Anyone with link · Viewer</em> first).
              </p>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowLinkForm(true)}
              className={cn(courseButton, "mb-3 cursor-pointer")}
            >
              <Link2 className="h-3.5 w-3.5" />
              Add link (for big files / external resources)
            </button>
          )
        ) : null}

        {resources.length > 0 ? (
          <div className="space-y-2">
            {resources.map((r) => (
              <ResourceRow
                key={r.id}
                resource={r}
                onDelete={() => onDeleteResource(r)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No resources yet. Upload files or add a link above.
          </p>
        )}
      </div>
    </div>
  );
}
