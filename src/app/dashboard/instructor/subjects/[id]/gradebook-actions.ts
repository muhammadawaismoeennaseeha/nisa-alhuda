"use server";

/**
 * Gradebook — server actions for manual assessments and marks (migration 035).
 *
 * Same discipline as the quiz engine: every write goes through the
 * service-role client AFTER requireRole gates the caller to staff (admin OR
 * instructor, per migration 028's content model), and every change is written
 * to the audit log (module 2).
 *
 * RECORDS SAFETY. Marks are a student record. A student can never reach these
 * actions (requireRole), and the RLS on assessment_grades has no student-write
 * policy at all, so the only path to a mark is a staff member here. Quiz marks
 * are NOT touched by any of this — they live in quiz_attempts and are read-only
 * to the gradebook.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, assertAssistsIfTA } from "@/lib/db/auth";
import { logAudit } from "@/lib/db/audit";

type Result<T = void> = { success: boolean; error?: string; data?: T };

// A Teaching Assistant is course-scoped: assertAssistsIfTA() confirms they
// assist the target offering before any write. Admin/instructor stay global.
const STAFF = ["admin", "instructor", "ta"] as const;
const ASSESSMENT_TYPES = ["assignment", "exam", "participation", "custom"] as const;
type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export interface AssessmentInput {
  title: string;
  type: AssessmentType;
  maxMarks: number;
}

function validate(input: AssessmentInput): string | null {
  if (!input.title.trim()) return "Give the assessment a title.";
  if (!ASSESSMENT_TYPES.includes(input.type)) return "Pick a valid type.";
  if (!Number.isFinite(input.maxMarks) || input.maxMarks <= 0)
    return "Total marks must be greater than zero.";
  return null;
}

const path = (subjectId: string) =>
  `/dashboard/instructor/subjects/${subjectId}`;

/** Create a manual assessment column on a subject; returns its id. */
export async function createAssessment(
  subjectId: string,
  offeringId: string,
  input: AssessmentInput
): Promise<Result<{ id: string }>> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };
  const denied = await assertAssistsIfTA(auth, offeringId);
  if (denied) return { success: false, error: denied.error };
  const bad = validate(input);
  if (bad) return { success: false, error: bad };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("assessments")
    .insert({
      subject_id: subjectId,
      offering_id: offeringId,
      title: input.title.trim(),
      type: input.type,
      max_marks: input.maxMarks,
      created_by: auth.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createAssessment:", error);
    return { success: false, error: error?.message ?? "Could not create assessment." };
  }

  await logAudit({
    actorId: auth.userId,
    action: "assessment.created",
    entityType: "assessment",
    entityId: data.id,
    summary: `Created ${input.type} "${input.title.trim()}" (out of ${input.maxMarks})`,
    metadata: { subject_id: subjectId, offering_id: offeringId },
  });

  revalidatePath(path(subjectId));
  return { success: true, data: { id: data.id } };
}

/** Rename / retype / re-scale an assessment. */
export async function updateAssessment(
  assessmentId: string,
  subjectId: string,
  input: AssessmentInput
): Promise<Result> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };
  const bad = validate(input);
  if (bad) return { success: false, error: bad };

  const admin = createAdminClient();
  const { data: _scope } = await admin
    .from("assessments")
    .select("offering_id")
    .eq("id", assessmentId)
    .maybeSingle();
  const denied = await assertAssistsIfTA(auth, _scope?.offering_id);
  if (denied) return { success: false, error: denied.error };

  const { error } = await admin
    .from("assessments")
    .update({
      title: input.title.trim(),
      type: input.type,
      max_marks: input.maxMarks,
    })
    .eq("id", assessmentId);

  if (error) {
    console.error("updateAssessment:", error);
    return { success: false, error: error.message };
  }

  await logAudit({
    actorId: auth.userId,
    action: "assessment.updated",
    entityType: "assessment",
    entityId: assessmentId,
    summary: `Updated assessment "${input.title.trim()}"`,
    metadata: { subject_id: subjectId },
  });

  revalidatePath(path(subjectId));
  return { success: true };
}

/** Delete an assessment and (by cascade) every mark on it. */
export async function deleteAssessment(
  assessmentId: string,
  subjectId: string
): Promise<Result> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  const { data: _scope } = await admin
    .from("assessments")
    .select("offering_id")
    .eq("id", assessmentId)
    .maybeSingle();
  const denied = await assertAssistsIfTA(auth, _scope?.offering_id);
  if (denied) return { success: false, error: denied.error };
  // Count marks first so the audit trail records what was removed.
  const { count } = await admin
    .from("assessment_grades")
    .select("id", { count: "exact", head: true })
    .eq("assessment_id", assessmentId);

  const { error } = await admin.from("assessments").delete().eq("id", assessmentId);
  if (error) {
    console.error("deleteAssessment:", error);
    return { success: false, error: error.message };
  }

  await logAudit({
    actorId: auth.userId,
    action: "assessment.deleted",
    entityType: "assessment",
    entityId: assessmentId,
    summary: `Deleted assessment and ${count ?? 0} mark(s)`,
    metadata: { subject_id: subjectId, marks_removed: count ?? 0 },
  });

  revalidatePath(path(subjectId));
  return { success: true };
}

/**
 * Enter or change one student's marks on one assessment. Passing marks = null
 * CLEARS the mark (deletes the row) rather than storing a zero — an unmarked
 * item and a zero are different, and only a real zero should count toward the
 * average.
 */
export async function upsertGrade(
  assessmentId: string,
  studentId: string,
  subjectId: string,
  marks: number | null,
  feedback?: string | null
): Promise<Result> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  const { data: _scope } = await admin
    .from("assessments")
    .select("offering_id")
    .eq("id", assessmentId)
    .maybeSingle();
  const denied = await assertAssistsIfTA(auth, _scope?.offering_id);
  if (denied) return { success: false, error: denied.error };

  if (marks === null) {
    const { error } = await admin
      .from("assessment_grades")
      .delete()
      .eq("assessment_id", assessmentId)
      .eq("student_id", studentId);
    if (error) {
      console.error("upsertGrade(clear):", error);
      return { success: false, error: error.message };
    }
    await logAudit({
      actorId: auth.userId,
      action: "grade.cleared",
      entityType: "assessment_grade",
      entityId: assessmentId,
      summary: "Cleared a mark",
      metadata: { subject_id: subjectId, student_id: studentId },
    });
    revalidatePath(path(subjectId));
    return { success: true };
  }

  if (!Number.isFinite(marks) || marks < 0)
    return { success: false, error: "Marks must be zero or more." };

  const { error } = await admin.from("assessment_grades").upsert(
    {
      assessment_id: assessmentId,
      student_id: studentId,
      marks,
      feedback: feedback?.trim() || null,
      graded_by: auth.userId,
      graded_at: new Date().toISOString(),
    },
    { onConflict: "assessment_id,student_id" }
  );

  if (error) {
    console.error("upsertGrade:", error);
    return { success: false, error: error.message };
  }

  await logAudit({
    actorId: auth.userId,
    action: "grade.entered",
    entityType: "assessment_grade",
    entityId: assessmentId,
    summary: `Entered ${marks} mark(s)`,
    metadata: { subject_id: subjectId, student_id: studentId, marks },
  });

  revalidatePath(path(subjectId));
  return { success: true };
}
