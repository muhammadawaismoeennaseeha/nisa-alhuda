"use client";

/**
 * Lesson Materials — upload and manage a single class's downloadable files
 * from inside the admin course workspace.
 *
 * Before this, the workspace could only show a materials *count*; uploading
 * meant leaving for the instructor's subject screen. This dialog brings the
 * same capability in place, using the identical storage convention as
 * `instructor/resources/resource-uploader.tsx`:
 *
 *   • bucket `resources`, object key `<lessonId>/<timestamp>-<safeName>`
 *   • one row in `resources` { lesson_id, title, file_url, file_type, file_size }
 *
 * ─── Recordings ────────────────────────────────────────────────────────────
 *
 * Materials are a *separate* table and bucket from `lessons.recording_url`.
 * Nothing in this dialog reads, writes, or can reach a class recording — the
 * only copy of a recording lives on the lesson row and is edited nowhere but
 * the (locked-by-default) class dialog. Uploading or deleting a material here
 * cannot touch it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { isExternalUrl } from "@/lib/resource-helpers";
import { cn } from "@/lib/utils";
import { courseButton, courseIconButton, courseTag } from "./course-surface";
import type { Resource } from "@/lib/types/database";

/** Files uploaded to Storage are capped; large references go in as a link. */
const MAX_SIZE = 10 * 1024 * 1024;

const FILE_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  png: ImageIcon,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  webp: ImageIcon,
};

function iconFor(resource: Resource) {
  if (isExternalUrl(resource.file_url)) return Link2;
  return FILE_ICONS[resource.file_type?.toLowerCase() ?? ""] ?? FileIcon;
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LessonMaterialsDialog({
  open,
  onOpenChange,
  lesson,
  onCountChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: { id: string; title: string } | null;
  /** Report the lesson's new material count so the row badge stays in sync. */
  onCountChange?: (lessonId: string, count: number) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // External-link form
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [addingLink, setAddingLink] = useState(false);

  const lessonId = lesson?.id ?? null;

  // Load this lesson's materials whenever the dialog opens on a new lesson.
  useEffect(() => {
    if (!open || !lessonId) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .eq("lesson_id", lessonId)
        .order("created_at", { ascending: false });
      if (!alive) return;
      if (error) toast.error("Could not load materials.");
      setResources((data as Resource[]) ?? []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [open, lessonId]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!lessonId) return;
      const arr = Array.from(files);
      if (arr.length === 0) return;

      const oversized = arr.filter((f) => f.size > MAX_SIZE);
      if (oversized.length > 0) {
        toast.error(
          `Over 10MB — add these as a link instead: ${oversized
            .map((f) => f.name)
            .join(", ")}`
        );
        return;
      }

      setUploading(true);
      const supabase = createClient();
      const added: Resource[] = [];
      try {
        for (const file of arr) {
          const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
          const safeName = file.name
            .replace(/[^a-zA-Z0-9._-]/g, "_")
            .toLowerCase();
          const storagePath = `${lessonId}/${Date.now()}-${safeName}`;

          const { error: uploadError } = await supabase.storage
            .from("resources")
            .upload(storagePath, file);
          if (uploadError) {
            toast.error(`Failed to upload ${file.name}: ${uploadError.message}`);
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

          if (insertError || !row) {
            await supabase.storage.from("resources").remove([storagePath]);
            toast.error(`Failed to save ${file.name}.`);
            continue;
          }
          added.push(row as Resource);
        }
        if (added.length) {
          const next = [...added, ...resources];
          setResources(next);
          if (lessonId) onCountChange?.(lessonId, next.length);
          toast.success(
            added.length === 1
              ? "Material uploaded."
              : `${added.length} materials uploaded.`
          );
        }
      } finally {
        setUploading(false);
      }
    },
    [lessonId, resources, onCountChange]
  );

  async function addLink() {
    if (!lessonId) return;
    const url = linkUrl.trim();
    const title = linkTitle.trim() || url;
    if (!isExternalUrl(url)) {
      toast.error("Enter a full link starting with http:// or https://");
      return;
    }
    setAddingLink(true);
    try {
      const supabase = createClient();
      const { data: row, error } = await supabase
        .from("resources")
        .insert({
          lesson_id: lessonId,
          title,
          file_url: url,
          file_type: "link",
          file_size: 0,
        })
        .select()
        .single();
      if (error || !row) {
        toast.error("Could not add the link.");
        return;
      }
      const next = [row as Resource, ...resources];
      setResources(next);
      if (lessonId) onCountChange?.(lessonId, next.length);
      setLinkTitle("");
      setLinkUrl("");
      toast.success("Link added.");
    } finally {
      setAddingLink(false);
    }
  }

  async function remove(resource: Resource) {
    setDeletingId(resource.id);
    try {
      const supabase = createClient();
      // External links have no stored object to remove.
      if (!isExternalUrl(resource.file_url)) {
        await supabase.storage.from("resources").remove([resource.file_url]);
      }
      const { error } = await supabase
        .from("resources")
        .delete()
        .eq("id", resource.id);
      if (error) {
        toast.error("Failed to delete material.");
        return;
      }
      const next = resources.filter((r) => r.id !== resource.id);
      setResources(next);
      if (lessonId) onCountChange?.(lessonId, next.length);
      toast.success("Material deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Materials</DialogTitle>
          <DialogDescription>
            {lesson ? lesson.title : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Recording-safety reassurance. */}
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Materials are separate from class recordings — nothing here can
            change or remove a recording.
          </span>
        </div>

        {/* Dropzone */}
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
            if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
            dragOver
              ? "border-rose-400 bg-rose-50 dark:bg-rose-950/30"
              : "border-border-soft hover:border-rose-300 hover:bg-rose-50/50 dark:border-border dark:hover:bg-rose-950/20"
          )}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-rose-500" />
          ) : (
            <Upload className="h-5 w-5 text-rose-500" />
          )}
          <span className="text-[13px] font-medium">
            {uploading ? "Uploading…" : "Drop files or click to upload"}
          </span>
          <span className="text-[11px] text-muted-foreground">
            PDF, slides, images — up to 10MB each
          </span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* External link — for large references that exceed the 10MB cap. */}
        <div className="rounded-xl border border-border-soft p-3 dark:border-border">
          <Label className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
            Or add a link (Google Drive, large PDFs…)
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={linkTitle}
              onChange={(e) => setLinkTitle(e.target.value)}
              placeholder="Title (optional)"
              className="h-8 text-sm sm:w-2/5"
            />
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://…"
              className="h-8 flex-1 text-sm"
            />
            <button
              type="button"
              className={cn(courseButton, "shrink-0 cursor-pointer")}
              onClick={addLink}
              disabled={addingLink || !linkUrl.trim()}
            >
              {addingLink ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Add"
              )}
            </button>
          </div>
        </div>

        {/* Existing materials */}
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {loading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />
              Loading…
            </p>
          ) : resources.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No materials yet.
            </p>
          ) : (
            resources.map((r) => {
              const Icon = iconFor(r);
              const external = isExternalUrl(r.file_url);
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-2.5 rounded-lg border border-border-soft px-3 py-2 dark:border-border"
                >
                  <Icon className="h-4 w-4 shrink-0 text-rose-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {r.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {external ? (
                        <span className="inline-flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" />
                          link
                        </span>
                      ) : (
                        [r.file_type?.toUpperCase(), formatSize(r.file_size)]
                          .filter(Boolean)
                          .join(" · ")
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={cn(
                      courseIconButton,
                      "hover:border-[#E4A9A9] hover:bg-[#FBEEEE] hover:text-[#9A3D3D] dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    )}
                    onClick={() => remove(r)}
                    disabled={deletingId === r.id}
                    aria-label={`Delete ${r.title}`}
                    title="Delete material"
                  >
                    {deletingId === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className={courseTag}>
            {resources.length}{" "}
            {resources.length === 1 ? "material" : "materials"}
          </span>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
