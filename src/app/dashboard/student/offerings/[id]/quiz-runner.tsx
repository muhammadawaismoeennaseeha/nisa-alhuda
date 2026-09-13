"use client";

/**
 * Quiz Runner — the student's side of the built-in quiz engine.
 *
 * Lists the published quizzes on a subject. A quiz already sat shows its score
 * and is done (one attempt only). An unattempted quiz opens into the paper —
 * numbered question cards with single-choice option rows, mirroring Naseeha's
 * quiz look — and, on submit, an instant result screen.
 *
 * The answer key never reaches this component: options come from
 * `get_quiz_paper` (stripped) and grading happens in `submit_quiz_attempt`.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardCheck,
  Loader2,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { courseButton, courseButtonPrimary, pillBase, pillTones } from "@/components/course/course-surface";
import { loadPaper, submitQuiz, type QuizPaper, type QuizResult } from "./quiz-actions";

const HAIRLINE = "border-border-soft dark:border-border";

export interface StudentQuizAttempt {
  score: number;
  max_score: number;
  percentage: number;
}
export interface StudentQuiz {
  id: string;
  title: string;
  question_count: number;
  total_marks: number;
  attempt: StudentQuizAttempt | null;
}

export function QuizRunner({ quizzes }: { quizzes: StudentQuiz[] }) {
  const router = useRouter();
  const [paper, setPaper] = useState<QuizPaper | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);

  async function openQuiz(quizId: string) {
    setLoadingId(quizId);
    const res = await loadPaper(quizId);
    setLoadingId(null);
    if (!res.success || !res.paper) {
      toast.error(res.error ?? "Could not open the quiz.");
      return;
    }
    setAnswers({});
    setResult(null);
    setPaper(res.paper);
  }

  function close() {
    setPaper(null);
    setResult(null);
    setAnswers({});
    router.refresh();
  }

  async function handleSubmit() {
    if (!paper) return;
    const unanswered = paper.questions.filter((q) => !answers[q.id]).length;
    if (unanswered > 0) {
      const ok = window.confirm(
        `You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit anyway?`
      );
      if (!ok) return;
    }
    setSubmitting(true);
    const payload = paper.questions.map((q) => ({
      question_id: q.id,
      option_id: answers[q.id] ?? null,
    }));
    const res = await submitQuiz(paper.id, payload);
    setSubmitting(false);
    if (!res.success || !res.result) {
      toast.error(res.error ?? "Could not submit.");
      return;
    }
    setResult(res.result);
  }

  // ── Result screen ──
  if (paper && result) {
    const pass = result.percentage >= 60;
    return (
      <div className={cn("rounded-[10px] border p-6 text-center", HAIRLINE)}>
        <CheckCircle2
          className={cn(
            "mx-auto h-12 w-12",
            pass ? "text-sage-700 dark:text-emerald-400" : "text-rose-500"
          )}
        />
        <h4 className="mt-3 font-heading text-[16px] font-semibold">{paper.title}</h4>
        <div
          className={cn(
            "mx-auto mt-3 inline-block rounded-full px-4 py-1 text-[15px] font-bold",
            pass ? pillTones.success : pillTones.brand
          )}
        >
          {result.percentage}%
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {result.score} / {result.max_score} marks
        </p>
        <button type="button" className={cn(courseButton, "press mt-4")} onClick={close}>
          Done
        </button>
      </div>
    );
  }

  // ── Taking screen ──
  if (paper) {
    return (
      <div className={cn("rounded-[10px] border p-4", HAIRLINE)}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="font-heading text-[14px] font-semibold">{paper.title}</h4>
            {paper.instructions && (
              <p className="mt-0.5 text-xs text-muted-foreground">{paper.instructions}</p>
            )}
          </div>
          <button type="button" className={cn(courseButton, "press")} onClick={close}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {paper.questions.map((q, qi) => (
            <div key={q.id} className={cn("rounded-[8px] border p-3.5", HAIRLINE)}>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[12px] font-bold text-white">
                  {qi + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {q.text}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {Number(q.marks)} mark{Number(q.marks) === 1 ? "" : "s"}
                    </span>
                  </p>
                  <div className="mt-2.5 space-y-1.5">
                    {q.options.map((o) => {
                      const selected = answers[q.id] === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-[8px] border px-3 py-2 text-left text-sm transition-colors",
                            selected
                              ? "border-rose-400 bg-rose-50 dark:border-rose-600 dark:bg-rose-950/30"
                              : cn(HAIRLINE, "hover:bg-rose-50/50 dark:hover:bg-rose-950/20")
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                              selected ? "border-rose-500" : "border-border"
                            )}
                          >
                            {selected && <span className="h-2 w-2 rounded-full bg-rose-500" />}
                          </span>
                          {o.text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className={cn(courseButtonPrimary, "press")}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {submitting ? "Submitting…" : "Submit quiz"}
          </button>
        </div>
      </div>
    );
  }

  // ── List ──
  return (
    <div className="space-y-2">
      {quizzes.map((q) => (
        <div
          key={q.id}
          className={cn("flex flex-col gap-2 rounded-[10px] border p-3.5 sm:flex-row sm:items-center", HAIRLINE)}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-steel-700 dark:text-sky-300" />
              <h4 className="font-heading text-[13.5px] font-semibold">{q.title}</h4>
              {q.attempt && (
                <span className={cn(pillBase, q.attempt.percentage >= 60 ? pillTones.success : pillTones.brand)}>
                  {q.attempt.score} / {q.attempt.max_score} · {q.attempt.percentage}%
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {q.attempt
                ? "You have completed this quiz."
                : `${q.question_count} question${q.question_count === 1 ? "" : "s"} · ${q.total_marks} marks`}
            </p>
          </div>
          {q.attempt ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-sage-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Completed
            </span>
          ) : (
            <button
              type="button"
              className={cn(courseButton, "press justify-center")}
              onClick={() => openQuiz(q.id)}
              disabled={loadingId === q.id}
            >
              {loadingId === q.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              Take quiz
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
