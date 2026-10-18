"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  Download,
  Upload,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  courseCard,
  courseButton,
  courseButtonPrimary,
  pillBase,
  pillTones,
} from "@/components/course/course-surface";
import { createClient } from "@/lib/supabase/client";
import { submitStudentAnswerSheet } from "@/app/dashboard/instructor/subjects/[id]/assignment-actions";

export interface StudentAssignmentItem {
  id: string;
  subjectId: string;
  subjectTitle: string;
  offeringId: string;
  title: string;
  instructions: string | null;
  /** Short-lived signed link, built on the server (private bucket). */
  questionPaperHref: string | null;
  fileName: string;
  maxMarks: number;
  dueDate: string | null;
  submission: {
    id: string;
    answerSheetUrl: string;
    fileName: string;
    score: number | null;
    feedback: string | null;
    submittedAt: string;
    gradedAt: string | null;
  } | null;
}

export function StudentAssignmentList({
  assignments,
  offeringId,
}: {
  assignments: StudentAssignmentItem[];
  offeringId: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  async function handleUploadAnswerSheet(
    assignmentId: string,
    file: File
  ) {
    setUploadingId(assignmentId);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploadingId(null);
      toast.error("Your session expired — please sign in again.");
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
    // Path contract enforced by the storage policy in migration 044:
    // student-submissions/<assignment>/<student>/<file>. The student id
    // segment is what lets the policy allow her folder and only hers.
    const storagePath = `student-submissions/${assignmentId}/${user.id}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("resources")
      .upload(storagePath, file);

    if (uploadError) {
      setUploadingId(null);
      toast.error(`Upload failed: ${uploadError.message}`);
      return;
    }

    const res = await submitStudentAnswerSheet(
      assignmentId,
      offeringId,
      storagePath,
      file.name,
      file.size
    );

    setUploadingId(null);
    if (!res.success) {
      toast.error(res.error ?? "Failed to submit answer sheet.");
      return;
    }

    toast.success("Answer sheet submitted successfully!");
    startTransition(() => router.refresh());
  }

  if (assignments.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
          <FileText className="h-4 w-4" />
        </div>
        <h3 className="font-heading text-sm font-semibold">
          Question Papers & Assignments ({assignments.length})
        </h3>
      </div>

      <div className="space-y-3">
        {assignments.map((a) => {
          const isGraded = a.submission?.score !== null && a.submission?.score !== undefined;
          const isSubmitted = !!a.submission;

          return (
            <div
              key={a.id}
              className={cn(courseCard, "p-4 space-y-3")}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-heading text-sm font-semibold">{a.title}</span>
                    <span className="text-[11px] font-medium text-muted-foreground bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-full">
                      {a.subjectTitle}
                    </span>
                    {isGraded ? (
                      <span className={cn(pillBase, pillTones.success, "text-xs font-bold")}>
                        Graded: {a.submission!.score} / {a.maxMarks} marks
                      </span>
                    ) : isSubmitted ? (
                      <span className={cn(pillBase, pillTones.steel, "text-xs")}>
                        Submitted — awaiting grade
                      </span>
                    ) : (
                      <span className={cn(pillBase, pillTones.brand, "text-xs")}>
                        Not submitted
                      </span>
                    )}
                  </div>
                  {a.instructions && (
                    <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                      {a.instructions}
                    </p>
                  )}
                  {a.dueDate && (
                    <p className="mt-1 text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Due date: {new Date(a.dueDate).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {a.questionPaperHref ? (
                  <a
                    href={a.questionPaperHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(courseButton, "press text-xs font-semibold gap-1.5 self-start sm:self-auto")}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download Question Paper ({a.fileName})
                  </a>
                ) : (
                  <span className="text-[11px] text-muted-foreground self-start sm:self-auto">
                    Question paper link unavailable — refresh the page.
                  </span>
                )}
              </div>

              {/* Feedback banner if graded */}
              {isGraded && a.submission?.feedback && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 text-xs">
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300">Teacher Feedback:</p>
                  <p className="text-emerald-700 dark:text-emerald-400 mt-0.5">{a.submission.feedback}</p>
                </div>
              )}

              {/* Answer sheet submission area */}
              <div className="border-t border-border/60 pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-stone-50/50 dark:bg-stone-900/40 -mx-4 -mb-4 p-4 rounded-b-[10px]">
                {isSubmitted ? (
                  <div className="text-xs">
                    <p className="font-medium text-stone-800 dark:text-stone-200 flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Answer Sheet Submitted: <span className="font-semibold">{a.submission?.fileName}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Submitted on {new Date(a.submission!.submittedAt).toLocaleString()}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Download the paper above, write your answers, and upload your completed document or photos here.
                  </p>
                )}

                <label className={cn(courseButtonPrimary, "press cursor-pointer text-xs font-semibold gap-1.5 shrink-0 self-start sm:self-auto")}>
                  {uploadingId === a.id ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" />
                      {isSubmitted ? "Re-upload Answer Sheet" : "Upload Answer Sheet"}
                    </>
                  )}
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    className="hidden"
                    disabled={uploadingId === a.id}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadAnswerSheet(a.id, f);
                    }}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
