/**
 * Class Form — create or edit a Class (a `lessons` row) within a subject.
 * Client Component with fields for title, description, schedule,
 * live class link, and recording URL. Resources are uploaded inline on
 * the parent Class card after creation, not in this form.
 */
"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { createLesson, diffLesson, updateLesson } from "@/lib/course-structure";
import {
  pktInputToUtcIso,
  utcIsoToPktInput,
} from "@/lib/recurring-schedule";
import type { Lesson } from "@/lib/types/database";

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
        recording_url: recordingUrl.trim() || null,
        is_published: isPublished,
      };

      if (isEditing) {
        await updateLesson(supabase, lesson.id, diffLesson(lesson, values));
        toast.success("Class updated!");
      } else {
        await createLesson(supabase, {
          ...values,
          offering_id: offeringId,
          subject_id: subjectId,
          sort_order: nextSortOrder,
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
      <Button variant="ghost" onClick={onClose} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-1.5" />
        Back to classes
      </Button>

      <Card>
        <CardContent className="p-6">
          <h2 className="font-heading font-semibold text-lg mb-5">
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
                Name it however helps students recognise it — a date, a topic,
                or both.
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Scheduled At */}
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Scheduled Date & Time</Label>
                <Input
                  id="scheduledAt"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  When will this class take place? Time is interpreted as
                  Pakistan Standard Time (PKT, UTC+5).
                </p>
              </div>

              {/* Published */}
              <div className="space-y-2">
                <Label htmlFor="isPublished">Visibility</Label>
                <select
                  id="isPublished"
                  className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 outline-none"
                  value={isPublished ? "true" : "false"}
                  onChange={(e) => setIsPublished(e.target.value === "true")}
                >
                  <option value="false">Draft — hidden from students</option>
                  <option value="true">Published — visible to enrolled students</option>
                </select>
              </div>
            </div>

            {/* Live Class Link */}
            <div className="space-y-2">
              <Label htmlFor="liveLink">Live class link (Google Meet, Zoom, etc.)</Label>
              <Input
                id="liveLink"
                type="url"
                placeholder="https://meet.google.com/abc-defg-hij"
                value={liveClassLink}
                onChange={(e) => setLiveClassLink(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Tip: paste your <span className="font-medium">recurring</span> Meet/Zoom URL —
                the same link can be reused for every class in this subject.
                Students see this link when the class is published.
              </p>
            </div>

            {/* Recording URL */}
            <div className="space-y-2">
              <Label htmlFor="recordingUrl">Recording URL</Label>
              <Input
                id="recordingUrl"
                type="url"
                placeholder="https://drive.google.com/... or https://youtube.com/..."
                value={recordingUrl}
                onChange={(e) => setRecordingUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Add after the class is over. Students keep lifetime access.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="press">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {isEditing ? "Saving..." : "Creating..."}
                  </>
                ) : isEditing ? (
                  "Save changes"
                ) : (
                  "Create class"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
