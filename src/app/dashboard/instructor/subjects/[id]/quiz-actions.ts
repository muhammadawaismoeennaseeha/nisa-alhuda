"use server";

/**
 * Quiz authoring — server actions for the built-in quiz engine (migration 034).
 *
 * All writes go through the service-role client AFTER requireRole gates the
 * caller to staff (admin OR instructor, matching migration 028's content
 * model), and every structural change is written to the audit log (module 2).
 *
 * RECORDS SAFETY. Once a student has sat a quiz, its questions and options are
 * frozen: editing or deleting them would cascade into quiz_answers and rewrite
 * a mark the gradebook may already have read. So saveQuestions and deleteQuiz
 * refuse the moment an attempt exists — the same discipline the rest of the
 * LMS applies to anything touching a student's record.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, assertAssistsIfTA } from "@/lib/db/auth";
import { logAudit } from "@/lib/db/audit";

type Result<T = void> = { success: boolean; error?: string; data?: T };

// A Teaching Assistant is course-scoped: assertAssistsIfTA() below confirms
// they assist the target offering before any write. Admin/instructor stay global.
const STAFF = ["admin", "instructor", "ta"] as const;

export interface QuizOptionInput {
  text: string;
  is_correct: boolean;
}
export interface QuizQuestionInput {
  text: string;
  marks: number;
  options: QuizOptionInput[];
}

async function attemptCount(
  admin: ReturnType<typeof createAdminClient>,
  quizId: string
): Promise<number> {
  const { count } = await admin
    .from("quiz_attempts")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", quizId);
  return count ?? 0;
}

/** Create an empty draft quiz on a subject; returns its id. */
export async function createQuiz(
  subjectId: string,
  offeringId: string,
  title: string
): Promise<Result<{ id: string }>> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };
  const denied = await assertAssistsIfTA(auth, offeringId);
  if (denied) return { success: false, error: denied.error };
  const clean = title.trim();
  if (!clean) return { success: false, error: "Give the quiz a title." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("quizzes")
    .insert({
      subject_id: subjectId,
      offering_id: offeringId,
      title: clean,
      is_published: false,
      created_by: auth.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createQuiz:", error);
    return { success: false, error: error?.message ?? "Could not create quiz." };
  }

  await logAudit({
    actorId: auth.userId,
    action: "quiz.created",
    entityType: "quiz",
    entityId: data.id,
    summary: `Created quiz "${clean}"`,
    metadata: { subject_id: subjectId, offering_id: offeringId },
  });

  revalidatePath(`/dashboard/instructor/subjects/${subjectId}`);
  return { success: true, data: { id: data.id } };
}

/** Rename a quiz / edit its instructions. Always allowed (not structural). */
export async function updateQuizMeta(
  quizId: string,
  subjectId: string,
  fields: { title: string; instructions: string | null }
): Promise<Result> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };
  const clean = fields.title.trim();
  if (!clean) return { success: false, error: "Give the quiz a title." };

  const admin = createAdminClient();
  const { data: _scope } = await admin
    .from("quizzes")
    .select("offering_id")
    .eq("id", quizId)
    .maybeSingle();
  const denied = await assertAssistsIfTA(auth, _scope?.offering_id);
  if (denied) return { success: false, error: denied.error };

  const { error } = await admin
    .from("quizzes")
    .update({ title: clean, instructions: fields.instructions?.trim() || null })
    .eq("id", quizId);
  if (error) return { success: false, error: error.message };

  await logAudit({
    actorId: auth.userId,
    action: "quiz.updated",
    entityType: "quiz",
    entityId: quizId,
    summary: `Edited quiz details "${clean}"`,
  });
  revalidatePath(`/dashboard/instructor/subjects/${subjectId}`);
  return { success: true };
}

/**
 * Replace the whole question set for a quiz. Validates every question has a
 * body, ≥2 options and exactly one correct answer, then rewrites the tree in
 * one shot. Refused once any student has attempted the quiz.
 */
export async function saveQuestions(
  quizId: string,
  subjectId: string,
  questions: QuizQuestionInput[]
): Promise<Result> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  const { data: _scope } = await admin
    .from("quizzes")
    .select("offering_id")
    .eq("id", quizId)
    .maybeSingle();
  const denied = await assertAssistsIfTA(auth, _scope?.offering_id);
  if (denied) return { success: false, error: denied.error };
  if ((await attemptCount(admin, quizId)) > 0) {
    return {
      success: false,
      error: "This quiz has already been taken, so its questions are locked.",
    };
  }

  // Validate before touching the database.
  if (questions.length === 0) {
    return { success: false, error: "Add at least one question." };
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.text.trim()) return { success: false, error: `Question ${i + 1} has no text.` };
    if (!(q.marks > 0)) return { success: false, error: `Question ${i + 1} needs marks above zero.` };
    const opts = q.options.filter((o) => o.text.trim());
    if (opts.length < 2) return { success: false, error: `Question ${i + 1} needs at least two options.` };
    if (opts.filter((o) => o.is_correct).length !== 1) {
      return { success: false, error: `Question ${i + 1} needs exactly one correct option.` };
    }
  }

  // Rewrite: delete existing questions (options cascade), reinsert in order.
  const { error: delErr } = await admin.from("quiz_questions").delete().eq("quiz_id", quizId);
  if (delErr) return { success: false, error: delErr.message };

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const { data: qRow, error: qErr } = await admin
      .from("quiz_questions")
      .insert({ quiz_id: quizId, text: q.text.trim(), marks: q.marks, sort_order: i })
      .select("id")
      .single();
    if (qErr || !qRow) return { success: false, error: qErr?.message ?? "Could not save a question." };

    const optRows = q.options
      .filter((o) => o.text.trim())
      .map((o, j) => ({
        question_id: qRow.id,
        text: o.text.trim(),
        is_correct: o.is_correct,
        sort_order: j,
      }));
    const { error: oErr } = await admin.from("quiz_options").insert(optRows);
    if (oErr) return { success: false, error: oErr.message };
  }

  await logAudit({
    actorId: auth.userId,
    action: "quiz.updated",
    entityType: "quiz",
    entityId: quizId,
    summary: `Saved ${questions.length} question${questions.length === 1 ? "" : "s"}`,
  });
  revalidatePath(`/dashboard/instructor/subjects/${subjectId}`);
  return { success: true };
}

/** Publish / unpublish. A quiz needs at least one question to go live. */
export async function setPublished(
  quizId: string,
  subjectId: string,
  published: boolean
): Promise<Result> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  const { data: _scope } = await admin
    .from("quizzes")
    .select("offering_id")
    .eq("id", quizId)
    .maybeSingle();
  const denied = await assertAssistsIfTA(auth, _scope?.offering_id);
  if (denied) return { success: false, error: denied.error };
  if (published) {
    const { count } = await admin
      .from("quiz_questions")
      .select("id", { count: "exact", head: true })
      .eq("quiz_id", quizId);
    if ((count ?? 0) === 0) {
      return { success: false, error: "Add a question before publishing." };
    }
  }

  const { data: quiz } = await admin.from("quizzes").select("title").eq("id", quizId).single();
  const { error } = await admin
    .from("quizzes")
    .update({ is_published: published })
    .eq("id", quizId);
  if (error) return { success: false, error: error.message };

  await logAudit({
    actorId: auth.userId,
    action: published ? "quiz.published" : "quiz.unpublished",
    entityType: "quiz",
    entityId: quizId,
    summary: `${published ? "Published" : "Unpublished"} quiz "${quiz?.title ?? ""}"`,
  });
  revalidatePath(`/dashboard/instructor/subjects/${subjectId}`);
  return { success: true };
}

/** Delete a quiz. Refused once it has been attempted (protects marks). */
export async function deleteQuiz(quizId: string, subjectId: string): Promise<Result> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  const { data: _scope } = await admin
    .from("quizzes")
    .select("offering_id")
    .eq("id", quizId)
    .maybeSingle();
  const denied = await assertAssistsIfTA(auth, _scope?.offering_id);
  if (denied) return { success: false, error: denied.error };
  if ((await attemptCount(admin, quizId)) > 0) {
    return {
      success: false,
      error: "This quiz has been taken by students, so it cannot be deleted.",
    };
  }

  const { data: quiz } = await admin.from("quizzes").select("title").eq("id", quizId).single();
  const { error } = await admin.from("quizzes").delete().eq("id", quizId);
  if (error) return { success: false, error: error.message };

  await logAudit({
    actorId: auth.userId,
    action: "quiz.deleted",
    entityType: "quiz",
    entityId: quizId,
    summary: `Deleted quiz "${quiz?.title ?? ""}"`,
  });
  revalidatePath(`/dashboard/instructor/subjects/${subjectId}`);
  return { success: true };
}
