/**
 * Offering Form — reusable form for creating and editing offerings.
 * Client Component: handles form state, validation, and Supabase mutations.
 *
 * When `offering` prop is passed → edit mode.
 * When absent → create mode.
 */
"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Plus,
  Trash2,
  GripVertical,
  ArrowLeft,
  ImagePlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Offering, Subject, OfferingType, OfferingStatus, FeeType, OfferingMode } from "@/lib/types/database";

interface SubjectDraft {
  id?: string; // existing subjects have an id
  title: string;
  slug: string;
  description: string;
  sort_order: number;
  instructor_id: string;
  /** Stable Zoom/Meet URL reused for every weekly class. */
  recurring_meeting_url: string;
  /** Free-text label like "Mondays 6–7 PM PKT". */
  recurring_schedule_label: string;
  /** "" | "0".."6" — empty string means "no fixed day". */
  recurring_day_of_week: string;
  /** "HH:MM" 24-hour. */
  recurring_start_time: string;
  /** Numeric string. */
  recurring_duration_minutes: string;
}

interface InstructorOption {
  id: string;
  full_name: string;
}

interface OfferingFormProps {
  offering?: Offering;
  existingSubjects?: Subject[];
  instructors?: InstructorOption[];
  /**
   * Instructor-viewing flag. When true, hide Price and Fee Type — those
   * sit with admin/treasurer. Existing values on the offering are kept
   * verbatim on save (the inputs render but stay at their initial state).
   */
  hideFinance?: boolean;
  /**
   * Where Cancel goes and where a successful save lands. Defaults to the
   * offerings list; the course workspace points it back at itself so editing
   * doesn't bounce the admin out of the course they're working on.
   */
  returnHref?: string;
  /**
   * The "Back to Offerings" link. Off when the form is embedded in a screen
   * that already has its own back affordance.
   */
  showBackLink?: boolean;
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function OfferingForm({
  offering,
  existingSubjects = [],
  instructors = [],
  hideFinance = false,
  returnHref = "/dashboard/admin/offerings",
  showBackLink = true,
}: OfferingFormProps) {
  const router = useRouter();
  const isEditing = !!offering;

  // Form state
  const [title, setTitle] = useState(offering?.title || "");
  const [slug, setSlug] = useState(offering?.slug || "");
  const [shortDescription, setShortDescription] = useState(
    offering?.short_description || ""
  );
  const [description, setDescription] = useState(offering?.description || "");
  const [type, setType] = useState<OfferingType>(offering?.type || "program");
  const [price, setPrice] = useState(offering?.price?.toString() || "0");
  const [status, setStatus] = useState<OfferingStatus>(
    offering?.status || "draft"
  );
  const [scheduleStart, setScheduleStart] = useState(
    offering?.schedule_start || ""
  );
  const [scheduleEnd, setScheduleEnd] = useState(offering?.schedule_end || "");
  const [feeType, setFeeType] = useState<FeeType>(offering?.fee_type || "one_time");
  const [mode, setMode] = useState<OfferingMode>(offering?.mode || "online");
  const [isNew, setIsNew] = useState(offering?.is_new || false);
  const [isOngoing, setIsOngoing] = useState(offering?.is_ongoing || false);
  const [admissionClosed, setAdmissionClosed] = useState(offering?.admission_closed || false);
  const [whatsappLink, setWhatsappLink] = useState(offering?.whatsapp_link || "");
  // Poster / thumbnail
  const posterInputRef = useRef<HTMLInputElement>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [existingPosterUrl] = useState<string | null>(offering?.thumbnail_url || null);
  const [removePoster, setRemovePoster] = useState(false);

  // Subjects (for programs)
  const [subjects, setSubjects] = useState<SubjectDraft[]>(
    existingSubjects.map((s) => ({
      id: s.id,
      title: s.title,
      slug: s.slug,
      description: s.description || "",
      sort_order: s.sort_order,
      instructor_id: s.instructor_id,
      recurring_meeting_url: s.recurring_meeting_url || "",
      recurring_schedule_label: s.recurring_schedule_label || "",
      recurring_day_of_week:
        s.recurring_day_of_week == null ? "" : String(s.recurring_day_of_week),
      // Postgres returns TIME columns as "HH:MM:SS" — slice to "HH:MM" for input[type=time].
      recurring_start_time: s.recurring_start_time
        ? s.recurring_start_time.slice(0, 5)
        : "",
      recurring_duration_minutes: s.recurring_duration_minutes
        ? String(s.recurring_duration_minutes)
        : "60",
    }))
  );

  const [saving, setSaving] = useState(false);

  // Auto-generate slug from title
  function handleTitleChange(value: string) {
    setTitle(value);
    if (!isEditing) {
      setSlug(generateSlug(value));
    }
  }

  // ─── Poster Handling ───────────────────────────────────

  function handlePosterSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (JPG, PNG, or WebP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB.");
      return;
    }
    setPosterFile(file);
    setRemovePoster(false);
    const reader = new FileReader();
    reader.onload = () => setPosterPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  function clearPoster() {
    setPosterFile(null);
    setPosterPreview(null);
    setRemovePoster(true);
    if (posterInputRef.current) posterInputRef.current.value = "";
  }

  // ─── Subject Management ────────────────────────────────

  function addSubject() {
    setSubjects((prev) => [
      ...prev,
      {
        title: "",
        slug: "",
        description: "",
        sort_order: prev.length + 1,
        instructor_id: instructors[0]?.id || "",
        recurring_meeting_url: "",
        recurring_schedule_label: "",
        recurring_day_of_week: "",
        recurring_start_time: "",
        recurring_duration_minutes: "60",
      },
    ]);
  }

  function updateSubject(index: number, field: keyof SubjectDraft, value: string) {
    setSubjects((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      // Auto-generate slug from title
      if (field === "title") {
        updated[index].slug = generateSlug(value);
      }
      return updated;
    });
  }

  function removeSubject(index: number) {
    setSubjects((prev) => prev.filter((_, i) => i !== index));
  }

  // ─── Submit ────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!title.trim()) {
      toast.error("Please enter a title.");
      return;
    }
    if (!slug.trim()) {
      toast.error("Please enter a slug.");
      return;
    }
    if (!description.trim()) {
      toast.error("Please enter a description.");
      return;
    }

    setSaving(true);

    try {
      const supabase = createClient();

      // Get current user for instructor_id
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const offeringData = {
        title: title.trim(),
        slug: slug.trim(),
        short_description: shortDescription.trim() || null,
        description: description.trim(),
        type,
        price: parseInt(price) || 0,
        fee_type: feeType,
        mode,
        is_new: isNew,
        is_ongoing: isOngoing,
        admission_closed: admissionClosed,
        whatsapp_link: whatsappLink.trim() || null,
        status,
        schedule_start: scheduleStart || null,
        schedule_end: scheduleEnd || null,
        instructor_id: offering?.instructor_id || user?.id,
      };

      let offeringId: string;

      if (isEditing) {
        // Update existing offering
        const { error } = await supabase
          .from("offerings")
          .update(offeringData)
          .eq("id", offering.id);

        if (error) throw new Error(`Update failed: ${error.message}`);
        offeringId = offering.id;
      } else {
        // Create new offering
        const { data, error } = await supabase
          .from("offerings")
          .insert(offeringData)
          .select("id")
          .single();

        if (error) throw new Error(`Create failed: ${error.message}`);
        offeringId = data.id;
      }

      // Handle subjects for programs
      if (type === "program") {
        // Get IDs of existing subjects that are still in the form
        const keptIds = subjects
          .filter((s) => s.id)
          .map((s) => s.id as string);

        // Delete removed subjects
        if (isEditing) {
          const existingIds = existingSubjects.map((s) => s.id);
          const deletedIds = existingIds.filter((id) => !keptIds.includes(id));
          if (deletedIds.length > 0) {
            await supabase
              .from("subjects")
              .delete()
              .in("id", deletedIds);
          }
        }

        // Upsert subjects
        for (let i = 0; i < subjects.length; i++) {
          const subject = subjects[i];
          if (!subject.title.trim()) continue;

          const subjectData = {
            offering_id: offeringId,
            title: subject.title.trim(),
            slug: subject.slug || generateSlug(subject.title),
            description: subject.description.trim() || null,
            instructor_id: subject.instructor_id || user?.id,
            sort_order: i + 1,
            // New: recurring schedule fields. Empty string → null so the
            // database keeps "no schedule set" as a clean NULL.
            recurring_meeting_url: subject.recurring_meeting_url.trim() || null,
            recurring_schedule_label:
              subject.recurring_schedule_label.trim() || null,
            recurring_day_of_week:
              subject.recurring_day_of_week === ""
                ? null
                : Number(subject.recurring_day_of_week),
            recurring_start_time: subject.recurring_start_time || null,
            recurring_duration_minutes:
              subject.recurring_duration_minutes.trim() === ""
                ? null
                : Number(subject.recurring_duration_minutes),
          };

          if (subject.id) {
            // Update existing
            await supabase
              .from("subjects")
              .update(subjectData)
              .eq("id", subject.id);
          } else {
            // Insert new
            await supabase.from("subjects").insert(subjectData);
          }
        }
      }

      // Handle poster upload / removal
      if (posterFile) {
        const ext = posterFile.name.split(".").pop();
        const filePath = `offerings/${offeringId}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("thumbnails")
          .upload(filePath, posterFile, { upsert: true });
        if (uploadError) throw new Error(`Poster upload failed: ${uploadError.message}`);
        const { data: urlData } = supabase.storage.from("thumbnails").getPublicUrl(filePath);
        await supabase
          .from("offerings")
          .update({ thumbnail_url: urlData.publicUrl })
          .eq("id", offeringId);
      } else if (removePoster && existingPosterUrl) {
        // Remove old poster from storage if it's a storage path
        if (!existingPosterUrl.startsWith("http")) {
          await supabase.storage.from("thumbnails").remove([existingPosterUrl]);
        } else {
          // Extract path from full URL: ...thumbnails/offerings/id.ext
          const match = existingPosterUrl.match(/thumbnails\/(.+)$/);
          if (match) await supabase.storage.from("thumbnails").remove([match[1]]);
        }
        await supabase
          .from("offerings")
          .update({ thumbnail_url: null })
          .eq("id", offeringId);
      }

      toast.success(
        isEditing ? "Offering updated!" : "Offering created!"
      );
      router.push(returnHref);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      {/* Back Link */}
      {showBackLink && (
        <LinkButton
          variant="ghost"
          href="/dashboard/admin/offerings"
          className="mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to Offerings
        </LinkButton>
      )}

      {/* ─── Basic Info ─────────────────────────────────── */}
      <Card>
        <CardContent className="p-6 space-y-5">
          <h2 className="font-heading font-semibold text-lg">Basic Info</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Title */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g. Sisterhood Islamic Studies"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                required
              />
            </div>

            {/* Slug */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="slug">
                URL Slug <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/offerings/</span>
                <Input
                  id="slug"
                  placeholder="sisterhood-islamic-studies"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  required
                  className="font-mono text-sm"
                />
              </div>
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 outline-none"
                value={type}
                onChange={(e) => setType(e.target.value as OfferingType)}
              >
                <option value="program">Program</option>
                <option value="course">Course</option>
                <option value="workshop">Workshop</option>
                <option value="class">Class</option>
              </select>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 outline-none"
                value={status}
                onChange={(e) => setStatus(e.target.value as OfferingStatus)}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            {/* Mode */}
            <div className="space-y-2">
              <Label htmlFor="mode">Mode</Label>
              <select
                id="mode"
                className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 outline-none"
                value={mode}
                onChange={(e) => setMode(e.target.value as OfferingMode)}
              >
                <option value="online">Online</option>
                <option value="onsite">Onsite</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>

            {/* Mark as New */}
            <div className="space-y-2 flex items-end gap-2">
              <label htmlFor="isNew" className="flex items-center gap-2 cursor-pointer h-8">
                <input
                  id="isNew"
                  type="checkbox"
                  checked={isNew}
                  onChange={(e) => setIsNew(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-sm font-medium">Show &quot;New&quot; badge</span>
              </label>
            </div>

            {/* Mark as On-going */}
            <div className="space-y-2 flex items-end gap-2">
              <label htmlFor="isOngoing" className="flex items-center gap-2 cursor-pointer h-8">
                <input
                  id="isOngoing"
                  type="checkbox"
                  checked={isOngoing}
                  onChange={(e) => setIsOngoing(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-sm font-medium">Show &quot;On-going&quot; badge</span>
              </label>
            </div>

            {/* Close Admissions */}
            <div className="space-y-2 flex items-end gap-2">
              <label htmlFor="admissionClosed" className="flex items-center gap-2 cursor-pointer h-8">
                <input
                  id="admissionClosed"
                  type="checkbox"
                  checked={admissionClosed}
                  onChange={(e) => setAdmissionClosed(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-sm font-medium">Close admissions (show &quot;Admission Closed!&quot; label)</span>
              </label>
            </div>

            {/* Short Description */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="shortDesc">Short Description</Label>
              <Input
                id="shortDesc"
                placeholder="One-liner for catalog cards"
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
              />
            </div>

            {/* Full Description */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">
                Full Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder="Detailed description shown on the offering page..."
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Poster / Thumbnail ──────────────────────────── */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="font-heading font-semibold text-lg">Poster</h2>
          <p className="text-sm text-muted-foreground">
            Upload an image that will appear on the catalog card and offering page.
          </p>

          {(posterPreview || (existingPosterUrl && !removePoster)) ? (
            <div className="relative w-full max-w-md">
              <img
                src={posterPreview || existingPosterUrl!}
                alt="Poster preview"
                className="w-full rounded-lg border object-cover aspect-[16/10]"
              />
              <button
                type="button"
                onClick={clearPoster}
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center transition-colors"
              >
                <X className="h-4 w-4 text-white" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => posterInputRef.current?.click()}
              className="w-full max-w-md aspect-[16/10] rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <ImagePlus className="h-8 w-8 text-muted-foreground/50" />
              <span className="text-sm text-muted-foreground">Click to upload poster</span>
              <span className="text-xs text-muted-foreground/60">JPG, PNG or WebP — max 5MB</span>
            </button>
          )}

          {(posterPreview || (existingPosterUrl && !removePoster)) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => posterInputRef.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5 mr-1.5" />
              Replace Poster
            </Button>
          )}

          <input
            ref={posterInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handlePosterSelect}
            className="hidden"
          />
        </CardContent>
      </Card>

      {/* ─── Pricing & Schedule ─────────────────────────── */}
      <Card>
        <CardContent className="p-6 space-y-5">
          <h2 className="font-heading font-semibold text-lg">
            {hideFinance ? "Schedule" : "Pricing & Schedule"}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {!hideFinance && (
              <>
                {/* Price */}
                <div className="space-y-2">
                  <Label htmlFor="price">Price (PKR)</Label>
                  <Input
                    id="price"
                    type="number"
                    min="0"
                    placeholder="0 for free"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>

                {/* Fee Type */}
                <div className="space-y-2">
                  <Label htmlFor="feeType">Fee Type</Label>
                  <select
                    id="feeType"
                    className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 outline-none"
                    value={feeType}
                    onChange={(e) => setFeeType(e.target.value as FeeType)}
                  >
                    <option value="one_time">One-time</option>
                    <option value="monthly">Per Month</option>
                  </select>
                </div>
              </>
            )}

            {/* Start Date */}
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={scheduleStart}
                onChange={(e) => setScheduleStart(e.target.value)}
              />
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={scheduleEnd}
                onChange={(e) => setScheduleEnd(e.target.value)}
              />
            </div>
          </div>

          {/* WhatsApp Group Link */}
          <div className="space-y-2">
            <Label htmlFor="whatsappLink">WhatsApp Group Link</Label>
            <Input
              id="whatsappLink"
              type="url"
              placeholder="https://chat.whatsapp.com/..."
              value={whatsappLink}
              onChange={(e) => setWhatsappLink(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Paste the WhatsApp group invite link. Enrolled students will see a
              &ldquo;Join WhatsApp Group&rdquo; button at the top of this offering&rsquo;s page.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ─── Subjects (Programs only) ───────────────────── */}
      {type === "program" && (
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-heading font-semibold text-lg">Subjects</h2>
                <p className="text-sm text-muted-foreground">
                  Add subjects that make up this program.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addSubject}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add Subject
              </Button>
            </div>

            {subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No subjects yet. Click &ldquo;Add Subject&rdquo; to get started.
              </p>
            ) : (
              <div className="space-y-4">
                {subjects.map((subject, index) => (
                  <div
                    key={index}
                    className="flex gap-3 p-4 rounded-xl border bg-muted/20"
                  >
                    <div className="flex items-start pt-2 text-muted-foreground">
                      <GripVertical className="h-4 w-4" />
                    </div>

                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Subject Title</Label>
                        <Input
                          placeholder="e.g. Fiqh — Islamic Jurisprudence"
                          value={subject.title}
                          onChange={(e) =>
                            updateSubject(index, "title", e.target.value)
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Instructor</Label>
                        <select
                          value={subject.instructor_id}
                          onChange={(e) =>
                            updateSubject(index, "instructor_id", e.target.value)
                          }
                          className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 outline-none"
                        >
                          <option value="">Select instructor...</option>
                          {instructors.map((inst) => (
                            <option key={inst.id} value={inst.id}>
                              {inst.full_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Slug</Label>
                        <Input
                          placeholder="auto-generated"
                          value={subject.slug}
                          onChange={(e) =>
                            updateSubject(index, "slug", e.target.value)
                          }
                          className="font-mono text-sm"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <Label className="text-xs">Description</Label>
                        <Textarea
                          placeholder="Brief description of this subject..."
                          rows={2}
                          value={subject.description}
                          onChange={(e) =>
                            updateSubject(index, "description", e.target.value)
                          }
                        />
                      </div>

                      {/* ─── Recurring class schedule ────────────────────
                          Set the day, time and the SAME meeting URL once
                          per subject. Students see "Mondays 6–7 PM PKT
                          [Join Live]" forever — no per-class data entry. */}
                      <div className="space-y-1 md:col-span-2 mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <p className="text-xs font-semibold text-primary mb-2">
                          Recurring class schedule (set once, used every week)
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Recurring meeting URL
                            </Label>
                            <Input
                              placeholder="https://us06web.zoom.us/j/..."
                              value={subject.recurring_meeting_url}
                              onChange={(e) =>
                                updateSubject(
                                  index,
                                  "recurring_meeting_url",
                                  e.target.value
                                )
                              }
                              className="text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Schedule label (shown to students)
                            </Label>
                            <Input
                              placeholder="e.g. Mondays 6–7 PM PKT"
                              value={subject.recurring_schedule_label}
                              onChange={(e) =>
                                updateSubject(
                                  index,
                                  "recurring_schedule_label",
                                  e.target.value
                                )
                              }
                              className="text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Day of week</Label>
                            <select
                              value={subject.recurring_day_of_week}
                              onChange={(e) =>
                                updateSubject(
                                  index,
                                  "recurring_day_of_week",
                                  e.target.value
                                )
                              }
                              className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground"
                            >
                              <option value="">— not set —</option>
                              <option value="0">Sunday</option>
                              <option value="1">Monday</option>
                              <option value="2">Tuesday</option>
                              <option value="3">Wednesday</option>
                              <option value="4">Thursday</option>
                              <option value="5">Friday</option>
                              <option value="6">Saturday</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Start time (PKT)</Label>
                              <Input
                                type="time"
                                value={subject.recurring_start_time}
                                onChange={(e) =>
                                  updateSubject(
                                    index,
                                    "recurring_start_time",
                                    e.target.value
                                  )
                                }
                                className="text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Duration (min)</Label>
                              <Input
                                type="number"
                                min={15}
                                max={300}
                                step={5}
                                value={subject.recurring_duration_minutes}
                                onChange={(e) =>
                                  updateSubject(
                                    index,
                                    "recurring_duration_minutes",
                                    e.target.value
                                  )
                                }
                                className="text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeSubject(index)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Actions ────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2">
        <LinkButton variant="outline" href={returnHref}>
          Cancel
        </LinkButton>

        <Button type="submit" size="lg" disabled={saving} className="press">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              {isEditing ? "Saving..." : "Creating..."}
            </>
          ) : isEditing ? (
            "Save Changes"
          ) : (
            "Create Offering"
          )}
        </Button>
      </div>
    </form>
  );
}
