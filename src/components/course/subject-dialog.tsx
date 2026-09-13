"use client";

/**
 * Add / edit one subject, from the admin course workspace.
 *
 * Covers the same columns the offering form's inline subject rows do — title,
 * description, instructor, weekly slot — but as a focused dialog on the course
 * itself, so an admin fixing one subject's time doesn't have to open and
 * re-save the whole offering.
 *
 * Saving goes through `createSubject` / `updateSubject` in
 * `@/lib/course-structure`; the slug is derived there too, so the
 * `UNIQUE(offering_id, slug)` constraint can't be tripped by two subjects with
 * the same name.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
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
  createSubject,
  updateSubject,
  uniqueSubjectSlug,
} from "@/lib/course-structure";
import type { Subject } from "@/lib/types/database";

export interface InstructorOption {
  id: string;
  full_name: string | null;
}

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const SELECT_CLASS =
  "flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 outline-none";

/** "18:00:00" → "18:00" for a `<input type="time">`; "" when unset. */
function toTimeInput(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

export function SubjectDialog({
  open,
  onOpenChange,
  offeringId,
  /** null = create a new subject. */
  subject,
  /** Slugs already used on this offering, for collision-free slugging. */
  takenSlugs,
  /** Where a newly created subject lands in the order. */
  nextSortOrder,
  instructors,
  /** Pre-selected instructor on create — normally the course's own. */
  defaultInstructorId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offeringId: string;
  subject: Subject | null;
  takenSlugs: string[];
  nextSortOrder: number;
  instructors: InstructorOption[];
  defaultInstructorId: string | null;
  onSaved: () => void;
}) {
  const isEditing = !!subject;

  const [title, setTitle] = useState(subject?.title ?? "");
  const [description, setDescription] = useState(subject?.description ?? "");
  const [instructorId, setInstructorId] = useState(
    subject?.instructor_id ?? defaultInstructorId ?? instructors[0]?.id ?? ""
  );
  const [meetingUrl, setMeetingUrl] = useState(
    subject?.recurring_meeting_url ?? ""
  );
  const [dayOfWeek, setDayOfWeek] = useState(
    subject?.recurring_day_of_week == null
      ? ""
      : String(subject.recurring_day_of_week)
  );
  const [startTime, setStartTime] = useState(
    toTimeInput(subject?.recurring_start_time ?? null)
  );
  const [duration, setDuration] = useState(
    subject?.recurring_duration_minutes == null
      ? ""
      : String(subject.recurring_duration_minutes)
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Please enter a subject title.");
      return;
    }
    // subjects.instructor_id is NOT NULL — a subject with no one to teach it
    // would be rejected by the database with a constraint error the admin
    // can't act on.
    if (!instructorId) {
      toast.error("Pick an instructor for this subject.");
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const values = {
        title: trimmed,
        description: description.trim() || null,
        instructor_id: instructorId,
        recurring_meeting_url: meetingUrl.trim() || null,
        recurring_day_of_week: dayOfWeek === "" ? null : Number(dayOfWeek),
        recurring_start_time: startTime ? `${startTime}:00` : null,
        recurring_duration_minutes:
          duration.trim() === "" ? null : Number(duration),
      };

      if (isEditing) {
        await updateSubject(supabase, subject.id, {
          ...values,
          slug: uniqueSubjectSlug(trimmed, takenSlugs, subject.slug),
        });
        toast.success("Subject updated.");
      } else {
        await createSubject(supabase, {
          ...values,
          offering_id: offeringId,
          slug: uniqueSubjectSlug(trimmed, takenSlugs),
          sort_order: nextSortOrder,
        });
        toast.success("Subject added.");
      }

      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save subject."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit subject" : "New subject"}</DialogTitle>
          <DialogDescription>
            Subjects group the classes of this course. The weekly slot is shown
            to students in Pakistan Standard Time.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-2 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subjectTitle">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="subjectTitle"
              placeholder="e.g. Fiqh of Worship"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subjectDesc">Description</Label>
            <Textarea
              id="subjectDesc"
              rows={2}
              placeholder="What does this subject cover?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subjectInstructor">
              Instructor <span className="text-destructive">*</span>
            </Label>
            <select
              id="subjectInstructor"
              className={SELECT_CLASS}
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
              required
            >
              <option value="">Select an instructor…</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.full_name ?? "Unnamed instructor"}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subjectMeetingUrl">Recurring meeting link</Label>
            <Input
              id="subjectMeetingUrl"
              type="url"
              placeholder="https://zoom.us/j/…"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Reused for every weekly class in this subject.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="subjectDay">Day</Label>
              <select
                id="subjectDay"
                className={SELECT_CLASS}
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(e.target.value)}
              >
                <option value="">No fixed day</option>
                {DAYS.map((d, i) => (
                  <option key={d} value={String(i)}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subjectTime">Start (PKT)</Label>
              <Input
                id="subjectTime"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subjectDuration">Minutes</Label>
              <Input
                id="subjectDuration"
                type="number"
                min={0}
                placeholder="60"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
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
              {isEditing ? "Save changes" : "Add subject"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
