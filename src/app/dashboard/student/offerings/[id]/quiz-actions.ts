"use server";

/**
 * Student quiz actions — a thin, audited wrapper over the two SECURITY DEFINER
 * functions from migration 034. The functions do all the trust work
 * (enrollment, publication, one-attempt, and grading with the answer key that
 * never leaves the database); these actions just carry the call and log it.
 */
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/db/auth";
import { logAudit } from "@/lib/db/audit";

import type { QuizQuestionType } from "@/lib/types/database";

export interface QuizPaperQuestion {
  id: string;
  text: string;
  marks: number;
  question_type: QuizQuestionType;
  options: { id: string; text: string }[];
}

export interface QuizPaper {
  id: string;
  title: string;
  instructions: string | null;
  time_limit_minutes: number | null;
  already_attempted: boolean;
  questions: QuizPaperQuestion[];
}

export interface QuizResult {
  attempt_id: string;
  score: number;
  max_score: number;
  percentage: number;
}

export interface QuizAnswerSubmission {
  question_id: string;
  option_id?: string | null;
  selected_option_ids?: string[] | null;
  text_answer?: string | null;
  ordered_option_ids?: string[] | null;
}

/** Fetch the paper to sit (options carry no answer key). */
export async function loadPaper(
  quizId: string
): Promise<{ success: boolean; error?: string; paper?: QuizPaper }> {
  const auth = await requireAuth();
  if (!auth.ok) return { success: false, error: auth.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_quiz_paper", { p_quiz_id: quizId });
  if (error) return { success: false, error: error.message };
  return { success: true, paper: data as QuizPaper };
}

/** Grade + record one attempt. Supports single choice, true/false, multi-select, ordering, fill-in-blank. */
export async function submitQuiz(
  quizId: string,
  answers: QuizAnswerSubmission[]
): Promise<{ success: boolean; error?: string; result?: QuizResult }> {
  const auth = await requireAuth();
  if (!auth.ok) return { success: false, error: auth.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_quiz_attempt", {
    p_quiz_id: quizId,
    p_answers: answers,
  });
  if (error) return { success: false, error: error.message };

  const result = data as QuizResult;
  await logAudit({
    actorId: auth.userId,
    action: "quiz.attempted",
    entityType: "quiz",
    entityId: quizId,
    summary: `Scored ${result.score}/${result.max_score} (${result.percentage}%)`,
    metadata: { attempt_id: result.attempt_id },
  });
  return { success: true, result };
}
