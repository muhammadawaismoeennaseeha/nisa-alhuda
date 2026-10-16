"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  Plus,
  Trash2,
  CheckCircle2,
  Eye,
  EyeOff,
  Download,
  Users,
  X,
  ExternalLink,
  Award,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  courseCard,
  courseButton,
  courseButtonPrimary,
  courseButtonDanger,
  pillBase,
  pillTones,
} from "@/components/course/course-surface";
import { CourseConfirmDialog } from "@/components/course/course-confirm";
import { createClient } from "@/lib/supabase/client";
import {
  createAssignmentPaper,
  setAssignmentPublished,
  deleteAssignmentPaper,
  getAssignmentSubmissions,
  gradeAssignmentSubmission,
  type AssignmentPaperRow,
  type AssignmentSubmissionDetail,
} from "./assignment-actions";

const HAIRLINE = "border-border-soft dark:border-border";

export function FileAssignmentManager({
  subjectId,
  offeringId,
  assignments,
}: {
  subjectId: string;
  offeringId: string;
  assignments: AssignmentPaperRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [modalOpen, setModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AssignmentPaperRow | null>(null);
  const [gradingAssignment, setGradingAssignment] = useState<AssignmentPaperRow | null>(null);

  // New assignment form state
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [maxMarks, setMaxMarks] = useState("100");
  const [dueDate, setDueDate] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCreateAssignment(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please provide a title.");
      return;
    }
    if (!selectedFile) {
      toast.error("Please upload a question paper file (PDF, Doc, Image).");
      return;
    }

    setUploading(true);
    const supabase = createClient();
    const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
    const storagePath = `assignments/${subjectId}/${Date.now()}-${safeName}`;

    // Upload to existing 'resources' bucket
    const { error: uploadError } = await supabase.storage
      .from("resources")
      .upload(storagePath, selectedFile);

    if (uploadError) {
      setUploading(false);
      toast.error(`Upload failed: ${uploadError.message}`);
      return;
    }

    const res = await createAssignmentPaper(subjectId, offeringId, {
      title: title.trim(),
      instructions: instructions.trim() || undefined,
      question_paper_url: storagePath,
      file_name: selectedFile.name,
      file_size: selectedFile.size,
      max_marks: Number(maxMarks) || 100,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
    });

    setUploading(false);
    if (!res.success) {
      toast.error(res.error ?? "Failed to create assignment.");
      return;
    }

    toast.success("Assignment created! You can now publish it for students.");
    setModalOpen(false);
    setTitle("");
    setInstructions("");
    setSelectedFile(null);
    startTransition(() => router.refresh());
  }

  async function handleTogglePublish(a: AssignmentPaperRow) {
    setBusyId(a.id);
    const res = await setAssignmentPublished(a.id, subjectId, !a.is_published);
    setBusyId(null);
    if (!res.success) {
      toast.error(res.error ?? "Could not update.");
      return;
    }
    toast.success(a.is_published ? "Assignment hidden." : "Assignment published for students.");
    startTransition(() => router.refresh());
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    const res = await deleteAssignmentPaper(pendingDelete.id, subjectId);
    setBusyId(null);
    setPendingDelete(null);
    if (!res.success) {
      toast.error(res.error ?? "Could not delete.");
      return;
    }
    toast.success("Assignment deleted.");
    startTransition(() => router.refresh());
  }

  return (
    <div className={cn(courseCard, "mt-5 px-[18px] py-4")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            <FileText className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h2 className="font-heading text-[13.5px] font-semibold">Written Assignments & Question Papers</h2>
            <p className="text-xs text-muted-foreground">
              Upload PDF or document question papers. Students download, solve, and upload their completed answer sheets for teacher grading.
            </p>
          </div>
        </div>
        <button
          type="button"
          className={cn(courseButtonPrimary, "press")}
          onClick={() => setModalOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Upload Question Paper
        </button>
      </div>

      {assignments.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No file assignments yet. Click &ldquo;Upload Question Paper&rdquo; to post a PDF assignment.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {assignments.map((a) => (
            <div
              key={a.id}
              className={cn("flex flex-col gap-2 rounded-[10px] border p-3.5 sm:flex-row sm:items-center", HAIRLINE)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-heading text-[13.5px] font-semibold">{a.title}</span>
                  <span className={cn(pillBase, a.is_published ? pillTones.success : pillTones.muted)}>
                    {a.is_published ? "Published" : "Draft"}
                  </span>
                  <span className={cn(pillBase, pillTones.steel, "text-[11px]")}>
                    Max: {a.max_marks} marks
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  File: <span className="font-medium">{a.file_name}</span>
                  {a.due_date && ` · Due: ${new Date(a.due_date).toLocaleDateString()}`}
                  {a.submission_count !== undefined && ` · ${a.submission_count} submission${a.submission_count === 1 ? "" : "s"}`}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={cn(courseButton, "press border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300")}
                  onClick={() => setGradingAssignment(a)}
                >
                  <Users className="h-3.5 w-3.5" />
                  View & Grade Submissions ({a.submission_count ?? 0})
                </button>
                <button
                  type="button"
                  className={cn(courseButton, "press")}
                  onClick={() => handleTogglePublish(a)}
                  disabled={busyId === a.id}
                >
                  {a.is_published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {a.is_published ? "Unpublish" : "Publish"}
                </button>
                <button
                  type="button"
                  className={cn(courseButton, courseButtonDanger, "press")}
                  onClick={() => setPendingDelete(a)}
                  disabled={busyId === a.id}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Question Paper Dialog */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3">
              <h3 className="font-heading text-base font-semibold">Upload New Question Paper</h3>
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground hover:bg-stone-100 dark:hover:bg-stone-800"
                onClick={() => setModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAssignment} className="space-y-4">
              <div>
                <label className="text-xs font-semibold">Assignment Title</label>
                <input
                  required
                  className="mt-1 w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-rose-400"
                  placeholder="e.g. Midterm Question Paper - Fiqh"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-semibold">Instructions for Students (Optional)</label>
                <textarea
                  className="mt-1 w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-rose-400"
                  rows={2}
                  placeholder="e.g. Download the PDF, solve all questions on paper, take photos/scans and upload back."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold">Max Marks</label>
                  <input
                    type="number"
                    min="1"
                    required
                    className="mt-1 w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-rose-400"
                    value={maxMarks}
                    onChange={(e) => setMaxMarks(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold">Due Date (Optional)</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-rose-400"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold">Question Paper File (PDF, Word doc, Image)</label>
                <input
                  type="file"
                  ref={fileInputRef}
                  required
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  className="mt-1 w-full text-xs"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className={cn(courseButton, "press")}
                  onClick={() => setModalOpen(false)}
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={cn(courseButtonPrimary, "press")}
                  disabled={uploading}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Create Assignment
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {pendingDelete && (
        <CourseConfirmDialog
          open
          onOpenChange={(open) => !open && setPendingDelete(null)}
          title="Delete assignment paper?"
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          busy={busyId === pendingDelete.id}
        >
          <p>
            &ldquo;{pendingDelete.title}&rdquo; will be deleted permanently.
          </p>
        </CourseConfirmDialog>
      )}

      {/* Grade Submissions Modal */}
      {gradingAssignment && (
        <AssignmentGradingDialog
          assignment={gradingAssignment}
          subjectId={subjectId}
          onClose={() => setGradingAssignment(null)}
        />
      )}
    </div>
  );
}

function AssignmentGradingDialog({
  assignment,
  subjectId,
  onClose,
}: {
  assignment: AssignmentPaperRow;
  subjectId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState<AssignmentSubmissionDetail[]>([]);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState<Record<string, string>>({});
  const [feedbackInput, setFeedbackInput] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await getAssignmentSubmissions(assignment.id);
      if (res.success && res.data) {
        setSubmissions(res.data);
        const scores: Record<string, string> = {};
        const fbs: Record<string, string> = {};
        for (const s of res.data) {
          if (s.score !== null) scores[s.id] = String(s.score);
          if (s.feedback) fbs[s.id] = s.feedback;
        }
        setScoreInput(scores);
        setFeedbackInput(fbs);
      }
      setLoading(false);
    }
    load();
  }, [assignment.id]);

  async function handleSaveGrade(subId: string) {
    const val = Number(scoreInput[subId]);
    if (!Number.isFinite(val) || val < 0) {
      toast.error("Please enter a valid mark.");
      return;
    }
    setGradingId(subId);
    const res = await gradeAssignmentSubmission(
      subId,
      subjectId,
      val,
      feedbackInput[subId] || undefined
    );
    setGradingId(null);
    if (!res.success) {
      toast.error(res.error ?? "Failed to save mark.");
      return;
    }
    toast.success("Marks saved and synced with Gradebook!");
    startTransition(() => router.refresh());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h3 className="font-heading text-base font-semibold">{assignment.title} — Student Submissions</h3>
            <p className="text-xs text-muted-foreground">Max marks: {assignment.max_marks}</p>
          </div>
          <button
            type="button"
            className="rounded-full p-1 text-muted-foreground hover:bg-stone-100 dark:hover:bg-stone-800"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
            </div>
          ) : submissions.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No students have uploaded answer sheets yet.
            </p>
          ) : (
            <div className="space-y-4">
              {submissions.map((s) => {
                const supabase = createClient();
                const { data } = supabase.storage.from("resources").getPublicUrl(s.answer_sheet_url);
                const isSaving = gradingId === s.id;

                return (
                  <div key={s.id} className="rounded-xl border border-border p-4 bg-card">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
                      <div>
                        <p className="font-heading text-sm font-semibold">{s.student_name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Submitted on {new Date(s.submitted_at).toLocaleString()}
                        </p>
                      </div>
                      <a
                        href={data.publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(courseButton, "press text-xs font-semibold gap-1.5")}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download Answer Sheet ({s.file_name})
                      </a>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground">Marks / {assignment.max_marks}</label>
                        <input
                          type="number"
                          min="0"
                          max={assignment.max_marks}
                          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-rose-400"
                          placeholder="e.g. 85"
                          value={scoreInput[s.id] ?? ""}
                          onChange={(e) => setScoreInput({ ...scoreInput, [s.id]: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-semibold text-muted-foreground">Teacher Feedback (Optional)</label>
                        <div className="mt-1 flex gap-2">
                          <input
                            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-rose-400"
                            placeholder="Feedback for the student..."
                            value={feedbackInput[s.id] ?? ""}
                            onChange={(e) => setFeedbackInput({ ...feedbackInput, [s.id]: e.target.value })}
                          />
                          <button
                            type="button"
                            className={cn(courseButtonPrimary, "press shrink-0 text-xs font-semibold")}
                            onClick={() => handleSaveGrade(s.id)}
                            disabled={isSaving}
                          >
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
