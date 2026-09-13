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
  ChevronUp,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { LessonForm } from "./lesson-form";
import { deleteLesson, updateLesson } from "@/lib/course-structure";
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

type ClassStatus =
  | { kind: "live"; label: "Live now"; tone: "text-emerald-600 bg-emerald-50 border-emerald-200"; icon: typeof Radio }
  | { kind: "upcoming"; label: string; tone: "text-blue-600 bg-blue-50 border-blue-200"; icon: typeof Clock }
  | { kind: "recorded"; label: "Recorded"; tone: "text-primary bg-primary/10 border-primary/20"; icon: typeof PlayCircle }
  | { kind: "missing-rec"; label: "No recording yet"; tone: "text-amber-600 bg-amber-50 border-amber-200"; icon: typeof Clock }
  | { kind: "draft"; label: "Draft"; tone: "text-muted-foreground bg-muted border-border"; icon: typeof Calendar };

function getClassStatus(lesson: Lesson): ClassStatus {
  if (!lesson.scheduled_at) {
    return {
      kind: "draft",
      label: "Draft",
      tone: "text-muted-foreground bg-muted border-border",
      icon: Calendar,
    };
  }
  const now = Date.now();
  const start = new Date(lesson.scheduled_at).getTime();
  // Treat a class as "live" within a generous 2-hour window from start
  // unless it already has a recording (then it's clearly done).
  const liveWindowEnd = start + 2 * 60 * 60 * 1000;
  if (now >= start && now <= liveWindowEnd && !lesson.recording_url) {
    return {
      kind: "live",
      label: "Live now",
      tone: "text-emerald-600 bg-emerald-50 border-emerald-200",
      icon: Radio,
    };
  }
  if (now < start) {
    const diff = start - now;
    const mins = Math.round(diff / 60000);
    let label: string;
    if (mins < 60) label = `Starts in ${mins}m`;
    else if (mins < 60 * 24) label = `Starts in ${Math.round(mins / 60)}h`;
    else label = `In ${Math.round(mins / (60 * 24))}d`;
    return {
      kind: "upcoming",
      label,
      tone: "text-blue-600 bg-blue-50 border-blue-200",
      icon: Clock,
    };
  }
  if (lesson.recording_url) {
    return {
      kind: "recorded",
      label: "Recorded",
      tone: "text-primary bg-primary/10 border-primary/20",
      icon: PlayCircle,
    };
  }
  return {
    kind: "missing-rec",
    label: "No recording yet",
    tone: "text-amber-600 bg-amber-50 border-amber-200",
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

  async function handleDeleteClass(lessonId: string) {
    if (!confirm("Delete this class and all of its resources? This cannot be undone.")) return;
    setDeletingId(lessonId);
    try {
      await deleteLesson(createClient(), lessonId);
      toast.success("Class deleted.");
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
    <div>
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

      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading font-semibold text-lg">
          Classes ({classLessons.length})
        </h2>
        <Button onClick={handleAddNew} className="press">
          <Plus className="h-4 w-4 mr-1.5" />
          Add Class
        </Button>
      </div>

      {classLessons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Video className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-lg mb-2">No classes yet</p>
            <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
              Add the first class — name it by date (e.g. &ldquo;27 Apr 2026&rdquo;) or by
              topic (e.g. &ldquo;Surah Al-Fatihah — Tafseer&rdquo;). You can include the
              live link, recording, and resource files.
            </p>
            <Button onClick={handleAddNew}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add First Class
            </Button>
          </CardContent>
        </Card>
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
                onDelete={() => handleDeleteClass(lesson.id)}
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
    <Card className={!lesson.is_published ? "opacity-80" : ""}>
      <CardContent className="p-0">
        {/* Header row — clickable to expand */}
        <button
          type="button"
          onClick={onToggle}
          className="w-full text-left p-4 hover:bg-muted/30 transition-colors rounded-t-xl"
        >
          <div className="flex items-start gap-3">
            <span className="font-mono text-xs text-muted-foreground w-6 pt-1 shrink-0">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="font-semibold truncate">{lesson.title}</h3>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.tone}`}
                >
                  <StatusIcon className="h-3 w-3" />
                  {status.label}
                </span>
                {!lesson.is_published && (
                  <Badge variant="outline" className="text-[10px]">
                    Hidden
                  </Badge>
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
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
            )}
          </div>
        </button>

        {/* Expanded body */}
        {isExpanded && (
          <div className="px-4 pb-4 border-t bg-muted/10">
            {/* Action row — live link / recording / edit / publish / delete */}
            <div className="flex flex-wrap items-center gap-2 pt-3 mb-4">
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
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 transition-colors"
                  >
                    <Radio className="h-3.5 w-3.5" />
                    Join live class
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium px-3 py-1.5">
                    No live link set
                  </span>
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
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium px-3 py-1.5 transition-colors"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  Watch recording
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {!lesson.recording_url && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium px-3 py-1.5">
                  No recording yet
                </span>
              )}

              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onTogglePublish}
                  disabled={togglingId === lesson.id}
                  title={lesson.is_published ? "Hide from students" : "Publish"}
                >
                  {togglingId === lesson.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : lesson.is_published ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onEdit}
                  title="Edit class"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onDelete}
                  disabled={deletingId === lesson.id}
                  title="Delete class"
                  className="text-muted-foreground hover:text-destructive"
                >
                  {deletingId === lesson.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
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
              <p className="text-sm text-muted-foreground mb-4 whitespace-pre-line">
                {lesson.description}
              </p>
            )}

            {/* Resources section */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
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
                className={`cursor-pointer rounded-lg border-2 border-dashed p-3 text-center transition-colors mb-3 ${
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
                }`}
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
                  <Upload className="h-4 w-4 text-primary" />
                  <span>
                    Drop files here or{" "}
                    <span className="text-primary font-medium">browse</span> · max
                    10MB each
                  </span>
                </div>
              </div>

              {resources.length > 0 ? (
                <div className="space-y-2">
                  {resources.map((r) => {
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
                                <span className="uppercase">{r.file_type}</span>
                              </>
                            )}
                          </p>
                        </div>
                        <ResourceLink path={r.file_url} fileName={r.title} />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onDeleteResource(r)}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          title="Delete resource"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No resources uploaded yet.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-heading font-semibold text-lg flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Resources
          {resources.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({resources.length})
            </span>
          )}
        </h2>
      </div>

      <Card>
        <CardContent className="p-4">
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
              className={`cursor-pointer rounded-lg border-2 border-dashed p-3 text-center transition-colors mb-3 ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
              }`}
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
                <Upload className="h-4 w-4 text-primary" />
                <span>
                  Drop files here or{" "}
                  <span className="text-primary font-medium">browse</span> · max
                  50MB each · students can download
                </span>
              </div>
            </div>
          ) : null}

          {/* Add link — for files too big for Storage (e.g. Drive PDFs). */}
          {uploadLessonId ? (
            showLinkForm ? (
              <form
                onSubmit={submitLink}
                className="rounded-lg border bg-muted/20 p-3 mb-3 space-y-2"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Link2 className="h-4 w-4 text-primary" />
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowLinkForm(false);
                      setLinkTitle("");
                      setLinkUrl("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={savingLink}>
                    {savingLink ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        Adding…
                      </>
                    ) : (
                      "Add link"
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tip: paste a Google Drive share link (set the file&apos;s
                  visibility to <em>Anyone with link · Viewer</em> first).
                </p>
              </form>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLinkForm(true)}
                className="mb-3"
              >
                <Link2 className="h-3.5 w-3.5 mr-1.5" />
                Add link (for big files / external resources)
              </Button>
            )
          ) : null}

          {resources.length > 0 ? (
            <div className="space-y-2">
              {resources.map((r) => {
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
                      <p className="text-sm font-medium truncate">{r.title}</p>
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
                            <span className="uppercase">{r.file_type}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <ResourceLink path={r.file_url} fileName={r.title} />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDeleteResource(r)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      title="Delete resource"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No resources yet. Upload files or add a link above.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
