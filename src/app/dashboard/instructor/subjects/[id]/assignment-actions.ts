"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole, assertAssistsIfTA } from "@/lib/db/auth";
import { logAudit } from "@/lib/db/audit";

type Result<T = void> = { success: boolean; error?: string; data?: T };
const STAFF = ["admin", "instructor", "ta"] as const;

/** How long a signed answer-sheet link stays valid. Long enough to open and
 *  mark a batch of submissions, short enough that a copied link goes stale. */
const ANSWER_SHEET_URL_TTL_SECONDS = 60 * 60;

export interface AssignmentPaperRow {
  id: string;
  subject_id: string;
  offering_id: string;
  title: string;
  instructions: string | null;
  question_paper_url: string;
  file_name: string;
  file_size: number | null;
  max_marks: number;
  due_date: string | null;
  is_published: boolean;
  submission_count?: number;
  created_at: string;
}

export interface AssignmentSubmissionDetail {
  id: string;
  assignment_id: string;
  student_id: string;
  student_name: string;
  answer_sheet_url: string;
  /**
   * Short-lived signed URL for `answer_sheet_url`. The `resources` bucket is
   * private, so a public URL 404s — and since migration 044 the submissions
   * prefix is readable only by its owner and staff anyway.
   */
  answer_sheet_href: string | null;
  file_name: string;
  file_size: number | null;
  score: number | null;
  feedback: string | null;
  submitted_at: string;
  graded_at: string | null;
}

/** Create a new Assignment Paper (Teacher uploads question paper) */
export async function createAssignmentPaper(
  subjectId: string,
  offeringId: string,
  input: {
    title: string;
    instructions?: string;
    question_paper_url: string;
    file_name: string;
    file_size?: number;
    max_marks: number;
    due_date?: string | null;
  }
): Promise<Result<{ id: string }>> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };
  const denied = await assertAssistsIfTA(auth, offeringId);
  if (denied) return { success: false, error: denied.error };

  const cleanTitle = input.title.trim();
  if (!cleanTitle) return { success: false, error: "Title is required." };
  if (!input.question_paper_url) return { success: false, error: "Question paper file is required." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("assignment_papers")
    .insert({
      subject_id: subjectId,
      offering_id: offeringId,
      title: cleanTitle,
      instructions: input.instructions?.trim() || null,
      question_paper_url: input.question_paper_url,
      file_name: input.file_name,
      file_size: input.file_size || null,
      max_marks: input.max_marks || 100,
      due_date: input.due_date || null,
      is_published: false,
      created_by: auth.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Could not create assignment." };
  }

  await logAudit({
    actorId: auth.userId,
    action: "assignment.created",
    entityType: "assignment_paper",
    entityId: data.id,
    summary: `Created assignment paper "${cleanTitle}"`,
    metadata: { subject_id: subjectId, offering_id: offeringId },
  });

  revalidatePath(`/dashboard/instructor/subjects/${subjectId}`);
  return { success: true, data: { id: data.id } };
}

/** Toggle published state of an assignment */
export async function setAssignmentPublished(
  assignmentId: string,
  subjectId: string,
  isPublished: boolean
): Promise<Result> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  // A TA is course-scoped — resolve the assignment's offering before
  // touching it, same pattern as quiz-actions.ts.
  const { data: _scope } = await admin
    .from("assignment_papers")
    .select("offering_id")
    .eq("id", assignmentId)
    .maybeSingle();
  const denied = await assertAssistsIfTA(auth, _scope?.offering_id);
  if (denied) return { success: false, error: denied.error };

  const { error } = await admin
    .from("assignment_papers")
    .update({ is_published: isPublished })
    .eq("id", assignmentId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/dashboard/instructor/subjects/${subjectId}`);
  return { success: true };
}

/** Delete an assignment paper */
export async function deleteAssignmentPaper(
  assignmentId: string,
  subjectId: string
): Promise<Result> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  // A TA is course-scoped — resolve the assignment's offering before
  // touching it, same pattern as quiz-actions.ts.
  const { data: _scope } = await admin
    .from("assignment_papers")
    .select("offering_id")
    .eq("id", assignmentId)
    .maybeSingle();
  const denied = await assertAssistsIfTA(auth, _scope?.offering_id);
  if (denied) return { success: false, error: denied.error };

  const { error } = await admin
    .from("assignment_papers")
    .delete()
    .eq("id", assignmentId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/dashboard/instructor/subjects/${subjectId}`);
  return { success: true };
}

/** Teacher grades a student's submitted answer sheet */
export async function gradeAssignmentSubmission(
  submissionId: string,
  subjectId: string,
  score: number,
  feedback?: string
): Promise<Result> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!Number.isFinite(score) || score < 0) {
    return { success: false, error: "Score must be a valid number >= 0." };
  }

  const admin = createAdminClient();
  // A TA may only grade submissions on a course she assists.
  const { data: _scope } = await admin
    .from("assignment_submissions")
    .select("assignment:assignment_papers!assignment_submissions_assignment_id_fkey(offering_id)")
    .eq("id", submissionId)
    .maybeSingle<{ assignment: { offering_id: string } | null }>();
  const denied = await assertAssistsIfTA(auth, _scope?.assignment?.offering_id);
  if (denied) return { success: false, error: denied.error };

  const { data: sub, error: subErr } = await admin
    .from("assignment_submissions")
    .update({
      score,
      feedback: feedback?.trim() || null,
      graded_by: auth.userId,
      graded_at: new Date().toISOString(),
    })
    .eq("id", submissionId)
    .select("assignment_id, student_id")
    .single();

  if (subErr || !sub) {
    return { success: false, error: subErr?.message ?? "Could not save grade." };
  }

  revalidatePath(`/dashboard/instructor/subjects/${subjectId}`);
  return { success: true };
}

/** Fetch all submissions for an assignment paper (Teacher View) */
export async function getAssignmentSubmissions(
  assignmentId: string
): Promise<Result<AssignmentSubmissionDetail[]>> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  // A TA is course-scoped — resolve the assignment's offering before
  // touching it, same pattern as quiz-actions.ts.
  const { data: _scope } = await admin
    .from("assignment_papers")
    .select("offering_id")
    .eq("id", assignmentId)
    .maybeSingle();
  const denied = await assertAssistsIfTA(auth, _scope?.offering_id);
  if (denied) return { success: false, error: denied.error };

  const { data, error } = await admin
    .from("assignment_submissions")
    .select(`
      id,
      assignment_id,
      student_id,
      answer_sheet_url,
      file_name,
      file_size,
      score,
      feedback,
      submitted_at,
      graded_at,
      student:profiles!assignment_submissions_student_id_fkey(full_name)
    `)
    .eq("assignment_id", assignmentId)
    .order("submitted_at", { ascending: false });

  if (error) return { success: false, error: error.message };

  // Sign every answer sheet in one round trip (private bucket — see 044).
  const paths = (data ?? [])
    .map((s) => s.answer_sheet_url)
    .filter((p): p is string => Boolean(p));
  const hrefByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await admin.storage
      .from("resources")
      .createSignedUrls(paths, ANSWER_SHEET_URL_TTL_SECONDS);
    for (const row of signed ?? []) {
      if (row.path && row.signedUrl) hrefByPath.set(row.path, row.signedUrl);
    }
  }

  const formatted: AssignmentSubmissionDetail[] = (data ?? []).map((s: any) => ({
    id: s.id,
    assignment_id: s.assignment_id,
    student_id: s.student_id,
    student_name: Array.isArray(s.student)
      ? s.student[0]?.full_name ?? "Student"
      : s.student?.full_name ?? "Student",
    answer_sheet_url: s.answer_sheet_url,
    answer_sheet_href: hrefByPath.get(s.answer_sheet_url) ?? null,
    file_name: s.file_name,
    file_size: s.file_size,
    score: s.score !== null ? Number(s.score) : null,
    feedback: s.feedback,
    submitted_at: s.submitted_at,
    graded_at: s.graded_at,
  }));

  return { success: true, data: formatted };
}

/**
 * Student submits / re-submits their completed answer sheet.
 *
 * Deliberately the USER-SCOPED client, not the service-role one. The
 * `assignment_submissions` policies from migration 042 are what enforce the
 * three rules that matter here — the assignment is published, she's enrolled
 * in its offering, and the row is her own. A service-role upsert bypasses
 * RLS entirely, so anyone with a session could have POSTed a submission to
 * any assignment id, for any assignment, enrolled or not.
 */
export async function submitStudentAnswerSheet(
  assignmentId: string,
  offeringId: string,
  fileUrl: string,
  fileName: string,
  fileSize?: number
): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be logged in to submit." };

  const { error } = await supabase
    .from("assignment_submissions")
    .upsert(
      {
        assignment_id: assignmentId,
        student_id: user.id,
        answer_sheet_url: fileUrl,
        file_name: fileName,
        file_size: fileSize || null,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "assignment_id,student_id" }
    );

  if (error) {
    // 42501 = row-level security violation: not enrolled, or the
    // assignment isn't published. Don't leak which.
    return {
      success: false,
      error:
        error.code === "42501"
          ? "This assignment isn't open for submissions from your account."
          : error.message,
    };
  }

  revalidatePath(`/dashboard/student/offerings/${offeringId}`);
  return { success: true };
}
