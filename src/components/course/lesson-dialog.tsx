"use client";

/**
 * Add / edit one lesson, from the admin course workspace.
 *
 * Same columns as the instructor's class form, and the same save path — both
 * call `createLesson` / `updateLesson` in `@/lib/course-structure`.
 *
 * ─── The recording field ───────────────────────────────────────────────────
 *
 * `recording_url` is the only copy of a class recording that exists. Two things
 * protect it here:
 *
 *   1. An edit saves `diffLesson(lesson, values)` — the columns that actually
 *      changed. Renaming a lesson emits `{ title }`, so the UPDATE statement
 *      never names `recording_url` and cannot blank it. This holds even if this
 *      form's recording input were removed tomorrow.
 *   2. When a lesson already has a recording, the input starts locked. Changing
 *      or clearing it takes a deliberate click on "Replace", which also reveals
 *      the warning. An admin cannot tab through the form and wipe a recording
 *      by accident.
 */
import { useState } from "react";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
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

export function LessonDialog({
  open,
  onOpenChange,
  offeringId,
  subjectId,
  /** null = create a new lesson. */
  lesson,
  nextSortOrder,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offeringId: string;
  /** The subject this lesson belongs to; null for an unassigned lesson. */
  subjectId: string | null;
  lesson: Lesson | null;
  nextSortOrder: number;
  onSaved: () => void;
}) {
  const isEditing = !!lesson;
  const lockedAtOpen = !!lesson && hasRecording(lesson);

  const [title, setTitle] = useState(lesson?.title ?? "");
  const [description, setDescription] = useState(lesson?.description ?? "");
  const [scheduledAt, setScheduledAt] = useState(
    lesson?.scheduled_at ? utcIsoToPktInput(lesson.scheduled_at) : ""
  );
  const [liveClassLink, setLiveClassLink] = useState(
    lesson?.live_class_link ?? ""
  );
  const [recordingUrl, setRecordingUrl] = useState(lesson?.recording_url ?? "");
  const [recordingUnlocked, setRecordingUnlocked] = useState(!lockedAtOpen);
  const [isPublished, setIsPublished] = useState(lesson?.is_published ?? false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Please enter a class title.");
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const values = {
        title: trimmed,
        description: description.trim() || null,
        scheduled_at: scheduledAt ? pktInputToUtcIso(scheduledAt) : null,
        live_class_link: liveClassLink.trim() || null,
        is_published: isPublished,
      };

      if (isEditing) {
        // The recording only joins the patch when the admin unlocked the field.
        // While locked, the key is absent — not `null`, not `""` — so the
        // column is never mentioned in the UPDATE.
        const patch = diffLesson(lesson, {
          ...values,
          ...(recordingUnlocked
            ? { recording_url: recordingUrl.trim() || null }
            : {}),
        });
        await updateLesson(supabase, lesson.id, patch);
        toast.success("Class updated.");
      } else {
        await createLesson(supabase, {
          ...values,
          offering_id: offeringId,
          subject_id: subjectId,
          sort_order: nextSortOrder,
          recording_url: recordingUrl.trim() || null,
        });
        toast.success("Class added.");
      }

      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save class."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit class" : "New class"}</DialogTitle>
          <DialogDescription>
            Name it however helps students recognise it — a date, a topic, or
            both.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-2 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lessonTitle">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="lessonTitle"
              placeholder="e.g. Surah Al-Fatihah — Tafseer"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lessonDesc">Description</Label>
            <Textarea
              id="lessonDesc"
              rows={3}
              placeholder="What will this class cover?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lessonScheduledAt">Date &amp; time (PKT)</Label>
              <Input
                id="lessonScheduledAt"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lessonPublished">Visibility</Label>
              <select
                id="lessonPublished"
                className={SELECT_CLASS}
                value={isPublished ? "true" : "false"}
                onChange={(e) => setIsPublished(e.target.value === "true")}
              >
                <option value="false">Draft — hidden from students</option>
                <option value="true">Published — visible to students</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lessonLiveLink">Live class link</Label>
            <Input
              id="lessonLiveLink"
              type="url"
              placeholder="https://meet.google.com/abc-defg-hij"
              value={liveClassLink}
              onChange={(e) => setLiveClassLink(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="lessonRecordingUrl">Recording URL</Label>
              {lockedAtOpen && !recordingUnlocked && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRecordingUnlocked(true)}
                >
                  <Lock className="mr-1.5 h-3.5 w-3.5" />
                  Replace
                </Button>
              )}
            </div>
            <Input
              id="lessonRecordingUrl"
              type="url"
              placeholder="https://drive.google.com/… or https://youtube.com/…"
              value={recordingUrl}
              onChange={(e) => setRecordingUrl(e.target.value)}
              readOnly={!recordingUnlocked}
              aria-describedby="lessonRecordingHelp"
            />
            <p id="lessonRecordingHelp" className="text-xs text-muted-foreground">
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

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save changes" : "Add class"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
