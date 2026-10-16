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

import type { QuizQuestionType } from "@/lib/types/database";

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
  question_type: QuizQuestionType;
  options: QuizOptionInput[];
}

export interface QuizSubmissionDetail {
  attempt_id: string;
  student_id: string;
  student_name: string;
  submitted_at: string;
  score: number;
  max_score: number;
  percentage: number;
  answers: {
    question_id: string;
    question_text: string;
    question_type: QuizQuestionType;
    marks: number;
    is_correct: boolean;
    selected_option_id: string | null;
    selected_option_ids: string[] | null;
    text_answer: string | null;
    ordered_option_ids: string[] | null;
    options: { id: string; text: string; is_correct: boolean; sort_order: number }[];
  }[];
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
    const type = q.question_type || "multiple_choice";
    if (!q.text.trim()) return { success: false, error: `Question ${i + 1} has no text.` };
    if (!(q.marks > 0)) return { success: false, error: `Question ${i + 1} needs marks above zero.` };
    const opts = q.options.filter((o) => o.text.trim());

    if (type === "multiple_choice") {
      if (opts.length < 2) return { success: false, error: `Question ${i + 1} (Multiple Choice) needs at least two options.` };
      if (opts.filter((o) => o.is_correct).length !== 1) {
        return { success: false, error: `Question ${i + 1} (Multiple Choice) needs exactly one correct option.` };
      }
    } else if (type === "true_false") {
      if (opts.length !== 2) return { success: false, error: `Question ${i + 1} (True/False) needs True and False options.` };
      if (opts.filter((o) => o.is_correct).length !== 1) {
        return { success: false, error: `Question ${i + 1} (True/False) needs one correct answer selected.` };
      }
    } else if (type === "multi_select") {
      if (opts.length < 2) return { success: false, error: `Question ${i + 1} (Multiple Select) needs at least two options.` };
      if (opts.filter((o) => o.is_correct).length < 1) {
        return { success: false, error: `Question ${i + 1} (Multiple Select) needs at least one correct option.` };
      }
    } else if (type === "ordering") {
      if (opts.length < 2) return { success: false, error: `Question ${i + 1} (Ordering) needs at least two items to arrange.` };
    } else if (type === "fill_in_blank") {
      if (opts.length < 1) return { success: false, error: `Question ${i + 1} (Fill in Blank) needs at least one correct answer.` };
    }
  }

  // Rewrite: delete existing questions (options cascade), reinsert in order.
  const { error: delErr } = await admin.from("quiz_questions").delete().eq("quiz_id", quizId);
  if (delErr) return { success: false, error: delErr.message };

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const type = q.question_type || "multiple_choice";
    const { data: qRow, error: qErr } = await admin
      .from("quiz_questions")
      .insert({
        quiz_id: quizId,
        text: q.text.trim(),
        marks: q.marks,
        question_type: type,
        sort_order: i,
      })
      .select("id")
      .single();
    if (qErr || !qRow) return { success: false, error: qErr?.message ?? "Could not save a question." };

    const optRows = q.options
      .filter((o) => o.text.trim())
      .map((o, j) => ({
        question_id: qRow.id,
        text: o.text.trim(),
        is_correct: type === "ordering" ? true : o.is_correct,
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

/** Fetch all student submissions / attempts for a quiz (Instructor assessment view). */
export async function getQuizSubmissions(
  quizId: string
): Promise<Result<QuizSubmissionDetail[]>> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();

  const { data: attempts, error: attErr } = await admin
    .from("quiz_attempts")
    .select(`
      id,
      student_id,
      submitted_at,
      score,
      max_score,
      percentage,
      student:profiles!quiz_attempts_student_id_fkey(full_name)
    `)
    .eq("quiz_id", quizId)
    .order("submitted_at", { ascending: false });

  if (attErr) return { success: false, error: attErr.message };
  if (!attempts || attempts.length === 0) return { success: true, data: [] };

  const attemptIds = attempts.map((a) => a.id);

  const { data: questions } = await admin
    .from("quiz_questions")
    .select(`
      id,
      text,
      marks,
      question_type,
      sort_order,
      options:quiz_options(id, text, is_correct, sort_order)
    `)
    .eq("quiz_id", quizId)
    .order("sort_order", { ascending: true });

  const { data: answers } = await admin
    .from("quiz_answers")
    .select(`
      attempt_id,
      question_id,
      is_correct,
      selected_option_id,
      selected_option_ids,
      text_answer,
      ordered_option_ids
    `)
    .in("attempt_id", attemptIds);

  const answersByAttempt = new Map<string, typeof answers>();
  for (const ans of answers ?? []) {
    const list = answersByAttempt.get(ans.attempt_id) ?? [];
    list.push(ans);
    answersByAttempt.set(ans.attempt_id, list);
  }

  const result: QuizSubmissionDetail[] = attempts.map((att) => {
    const stName = Array.isArray(att.student)
      ? att.student[0]?.full_name ?? "Student"
      : (att.student as { full_name?: string } | null)?.full_name ?? "Student";

    const attAnswers = answersByAttempt.get(att.id) ?? [];
    const answerMap = new Map(attAnswers.map((a) => [a.question_id, a]));

    const formattedAnswers = (questions ?? []).map((q) => {
      const ans = answerMap.get(q.id);
      const opts = [...(q.options ?? [])].sort((a, b) => a.sort_order - b.sort_order);

      return {
        question_id: q.id,
        question_text: q.text,
        question_type: (q.question_type as QuizQuestionType) || "multiple_choice",
        marks: Number(q.marks),
        is_correct: ans?.is_correct ?? false,
        selected_option_id: ans?.selected_option_id ?? null,
        selected_option_ids: ans?.selected_option_ids ?? null,
        text_answer: ans?.text_answer ?? null,
        ordered_option_ids: ans?.ordered_option_ids ?? null,
        options: opts,
      };
    });

    return {
      attempt_id: att.id,
      student_id: att.student_id,
      student_name: stName,
      submitted_at: att.submitted_at,
      score: Number(att.score),
      max_score: Number(att.max_score),
      percentage: Number(att.percentage),
      answers: formattedAnswers,
    };
  });

  return { success: true, data: result };
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
