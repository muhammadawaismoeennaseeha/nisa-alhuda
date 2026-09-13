/**
 * Class Form — create or edit a Class (a `lessons` row) within a subject.
 *
 * Client Component with fields for title, description, schedule, live class
 * link, and recording URL. Resources are uploaded inline on the parent Class
 * card after creation, not in this form.
 *
 * Presentation is the shared course surface (`@/components/course/*`), so the
 * instructor's form reads as the same object as the admin workspace's
 * `LessonDialog` — the two write the same columns through the same module.
 *
 * ─── The recording field ───────────────────────────────────────────────────
 *
 * `recording_url` is the only copy of a class recording that exists anywhere in
 * Nisa. Two things protect it here, exactly as in
 * `@/components/course/lesson-dialog`:
 *
 *   1. An edit saves `diffLesson(lesson, values)` — the columns that actually
 *      changed. Renaming a class emits `{ title }`, so the UPDATE never names
 *      `recording_url` and cannot blank it.
 *   2. When a class already has a recording, the input opens LOCKED. Changing
 *      or clearing it takes a deliberate click on "Replace", which also reveals
 *      the warning. While locked the key is ABSENT from the patch — not `null`,
 *      not `""` — so the column is never mentioned in the statement.
 *
 * Adding a recording to a class that has none is unchanged and unguarded: the
 * field opens editable, with no lock and no Replace button.
 */
"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  courseButton,
  courseButtonPrimary,
  courseCard,
} from "@/components/course/course-surface";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  createLesson,
  diffLesson,
  hasRecording,
  updateLesson,
} from "@/lib/course-structure";
import {
  pktInputToUtcIso,
  utcIsoToPktInput,
} from "@/lib/recurring-schedule";
import type { Lesson } from "@/lib/types/database";

const SELECT_CLASS =
  "flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 outline-none";

interface LessonFormProps {
  subjectId: string;
  offeringId: string;
  lesson: Lesson | null; // null = create mode
  nextSortOrder: number;
  onClose: () => void;
}

export function LessonForm({
  subjectId,
  offeringId,
  lesson,
  nextSortOrder,
  onClose,
}: LessonFormProps) {
  const isEditing = !!lesson;
  const lockedAtOpen = !!lesson && hasRecording(lesson);

  const [title, setTitle] = useState(lesson?.title || "");
  const [description, setDescription] = useState(lesson?.description || "");
  const [scheduledAt, setScheduledAt] = useState(
    lesson?.scheduled_at ? utcIsoToPktInput(lesson.scheduled_at) : ""
  );
  const [liveClassLink, setLiveClassLink] = useState(
    lesson?.live_class_link || ""
  );
  const [recordingUrl, setRecordingUrl] = useState(
    lesson?.recording_url || ""
  );
  const [recordingUnlocked, setRecordingUnlocked] = useState(!lockedAtOpen);
  const [isPublished, setIsPublished] = useState(
    lesson?.is_published ?? false
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!title.trim()) {
      toast.error("Please enter a class title.");
      return;
    }

    setSaving(true);

    try {
      const supabase = createClient();

      // This form owns the recording field, so it is one of the few callers
      // that may pass `recording_url` at all. `diffLesson` still narrows the
      // statement to what changed, so leaving the field alone leaves the
      // column alone. See src/lib/course-structure.ts.
      const values = {
        title: title.trim(),
        description: description.trim() || null,
        scheduled_at: scheduledAt ? pktInputToUtcIso(scheduledAt) : null,
        live_class_link: liveClassLink.trim() || null,
        is_published: isPublished,
      };

      if (isEditing) {
        // The recording only joins the patch when the instructor unlocked the
        // field. While locked, the key is absent — not `null`, not `""`.
        const patch = diffLesson(lesson, {
          ...values,
          ...(recordingUnlocked
            ? { recording_url: recordingUrl.trim() || null }
            : {}),
        });
        await updateLesson(supabase, lesson.id, patch);
        toast.success("Class updated!");
      } else {
        await createLesson(supabase, {
          ...values,
          offering_id: offeringId,
          subject_id: subjectId,
          sort_order: nextSortOrder,
          recording_url: recordingUrl.trim() || null,
        });
        toast.success("Class created!");
      }

      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save class."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClose}
        className="mb-3 inline-flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-rose-700 dark:hover:text-rose-300"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to classes
      </button>

      <div className={cn(courseCard, "p-5 sm:px-6 sm:py-[22px]")}>
        <h2 className="font-heading mb-5 text-lg font-bold tracking-[-0.01em]">
          {isEditing ? "Edit class" : "New class"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="lessonTitle">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="lessonTitle"
              placeholder="e.g. Surah Al-Fatihah — Tafseer  ·or·  27 Apr 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Name it however helps students recognise it — a date, a topic, or
              both.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="lessonDesc">Description</Label>
            <Textarea
              id="lessonDesc"
              placeholder="What will this class cover?"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Scheduled At */}
            <div className="space-y-2">
              <Label htmlFor="scheduledAt">Scheduled Date &amp; Time</Label>
              <Input
                id="scheduledAt"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                When will this class take place? Time is interpreted as Pakistan
                Standard Time (PKT, UTC+5).
              </p>
            </div>

            {/* Published */}
            <div className="space-y-2">
              <Label htmlFor="isPublished">Visibility</Label>
              <select
                id="isPublished"
                className={SELECT_CLASS}
                value={isPublished ? "true" : "false"}
                onChange={(e) => setIsPublished(e.target.value === "true")}
              >
                <option value="false">Draft — hidden from students</option>
                <option value="true">
                  Published — visible to enrolled students
                </option>
              </select>
            </div>
          </div>

          {/* Live Class Link */}
          <div className="space-y-2">
            <Label htmlFor="liveLink">
              Live class link (Google Meet, Zoom, etc.)
            </Label>
            <Input
              id="liveLink"
              type="url"
              placeholder="https://meet.google.com/abc-defg-hij"
              value={liveClassLink}
              onChange={(e) => setLiveClassLink(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Tip: paste your <span className="font-medium">recurring</span>{" "}
              Meet/Zoom URL — the same link can be reused for every class in
              this subject. Students see this link when the class is published.
            </p>
          </div>

          {/* Recording URL — locked when this class already has one. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="recordingUrl">Recording URL</Label>
              {lockedAtOpen && !recordingUnlocked && (
                <button
                  type="button"
                  className={cn(courseButton, "cursor-pointer px-3 py-1.5")}
                  onClick={() => setRecordingUnlocked(true)}
                >
                  <Lock className="h-3.5 w-3.5" />
                  Replace
                </button>
              )}
            </div>
            <Input
              id="recordingUrl"
              type="url"
              placeholder="https://drive.google.com/... or https://youtube.com/..."
              value={recordingUrl}
              onChange={(e) => setRecordingUrl(e.target.value)}
              readOnly={!recordingUnlocked}
              aria-describedby="recordingUrlHelp"
            />
            <p id="recordingUrlHelp" className="text-xs text-muted-foreground">
              {!recordingUnlocked ? (
                <>
                  This class already has a recording. It is left exactly as it
                  is saved unless you choose{" "}
                  <span className="font-medium">Replace</span>.
                </>
              ) : lockedAtOpen ? (
                <span className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Saving now overwrites the stored recording link. There is no
                  undo and no second copy.
                </span>
              ) : (
                <>Add after the class is over. Students keep lifetime access.</>
              )}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-border-soft pt-4 dark:border-border">
            <button
              type="button"
              className={cn(courseButton, "cursor-pointer")}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={cn(
                courseButtonPrimary,
                "press cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isEditing ? "Saving..." : "Creating..."}
                </>
              ) : isEditing ? (
                "Save changes"
              ) : (
                "Create class"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
