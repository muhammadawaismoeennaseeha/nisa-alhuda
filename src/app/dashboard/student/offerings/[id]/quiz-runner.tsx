"use client";

/**
 * Quiz Runner — the student's side of the built-in quiz engine.
 *
 * Supports diverse interactive question types:
 *   - Multiple Choice (single option radio)
 *   - True / False (True/False toggle cards)
 *   - Multiple Select (checkbox toggle)
 *   - Arrange in Order (Up/Down sequence reordering)
 *   - Fill in the Blank (text input field)
 *
 * All grading is performed server-side with instant feedback.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardCheck,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { courseButton, courseButtonPrimary, pillBase, pillTones } from "@/components/course/course-surface";
import {
  loadPaper,
  submitQuiz,
  type QuizPaper,
  type QuizResult,
  type QuizAnswerSubmission,
} from "./quiz-actions";

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

  // State per answer type
  const [singleAnswers, setSingleAnswers] = useState<Record<string, string>>({});
  const [multiAnswers, setMultiAnswers] = useState<Record<string, string[]>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [orderingAnswers, setOrderingAnswers] = useState<Record<string, { id: string; text: string }[]>>({});
  // Ordering questions arrive pre-filled with the server's shuffle, so the
  // state alone can't tell "arranged" from "never touched". Track the moves.
  const [orderingTouched, setOrderingTouched] = useState<Record<string, boolean>>({});

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
    setSingleAnswers({});
    setMultiAnswers({});
    setTextAnswers({});

    // Initialize ordering options map
    const initialOrdering: Record<string, { id: string; text: string }[]> = {};
    for (const q of res.paper.questions) {
      if (q.question_type === "ordering") {
        initialOrdering[q.id] = [...q.options];
      }
    }
    setOrderingAnswers(initialOrdering);
    setOrderingTouched({});

    setResult(null);
    setPaper(res.paper);
  }

  function close() {
    setPaper(null);
    setResult(null);
    setSingleAnswers({});
    setMultiAnswers({});
    setTextAnswers({});
    setOrderingAnswers({});
    setOrderingTouched({});
    router.refresh();
  }

  function toggleMultiSelect(questionId: string, optionId: string) {
    setMultiAnswers((prev) => {
      const current = prev[questionId] || [];
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      return { ...prev, [questionId]: next };
    });
  }

  function moveOrderingItem(questionId: string, index: number, direction: "up" | "down") {
    setOrderingAnswers((prev) => {
      const items = [...(prev[questionId] || [])];
      const targetIdx = direction === "up" ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= items.length) return prev;
      setOrderingTouched((t) => (t[questionId] ? t : { ...t, [questionId]: true }));
      const temp = items[index];
      items[index] = items[targetIdx];
      items[targetIdx] = temp;
      return { ...prev, [questionId]: items };
    });
  }

  async function handleSubmit() {
    if (!paper) return;

    let unanswered = 0;
    for (const q of paper.questions) {
      const type = q.question_type || "multiple_choice";
      if (type === "multiple_choice" || type === "true_false") {
        if (!singleAnswers[q.id]) unanswered++;
      } else if (type === "multi_select") {
        if (!multiAnswers[q.id] || multiAnswers[q.id].length === 0) unanswered++;
      } else if (type === "fill_in_blank") {
        if (!textAnswers[q.id] || !textAnswers[q.id].trim()) unanswered++;
      } else if (type === "ordering") {
        // Submitting the shuffle untouched is almost never a real answer.
        if (!orderingTouched[q.id]) unanswered++;
      }
    }

    if (unanswered > 0) {
      const ok = window.confirm(
        `You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit anyway?`
      );
      if (!ok) return;
    }

    setSubmitting(true);
    const payload: QuizAnswerSubmission[] = paper.questions.map((q) => {
      const type = q.question_type || "multiple_choice";
      if (type === "multi_select") {
        return {
          question_id: q.id,
          selected_option_ids: multiAnswers[q.id] || [],
        };
      }
      if (type === "fill_in_blank") {
        return {
          question_id: q.id,
          text_answer: textAnswers[q.id] || "",
        };
      }
      if (type === "ordering") {
        const ordered = (orderingAnswers[q.id] || q.options).map((o) => o.id);
        return {
          question_id: q.id,
          ordered_option_ids: ordered,
        };
      }
      return {
        question_id: q.id,
        option_id: singleAnswers[q.id] || null,
      };
    });

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

        <div className="mt-3 space-y-4">
          {paper.questions.map((q, qi) => {
            const type = q.question_type || "multiple_choice";
            return (
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

                    {/* 1. Multiple Choice (Single) */}
                    {type === "multiple_choice" && (
                      <div className="mt-2.5 space-y-1.5">
                        {q.options.map((o) => {
                          const selected = singleAnswers[q.id] === o.id;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => setSingleAnswers((a) => ({ ...a, [q.id]: o.id }))}
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
                    )}

                    {/* 2. True / False */}
                    {type === "true_false" && (
                      <div className="mt-2.5 flex gap-3">
                        {q.options.map((o) => {
                          const selected = singleAnswers[q.id] === o.id;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => setSingleAnswers((a) => ({ ...a, [q.id]: o.id }))}
                              className={cn(
                                "flex flex-1 items-center justify-center gap-2 rounded-[8px] border px-4 py-2.5 text-sm font-semibold transition-colors",
                                selected
                                  ? "border-rose-500 bg-rose-50 text-rose-900 dark:border-rose-600 dark:bg-rose-950/40 dark:text-rose-200"
                                  : cn(HAIRLINE, "hover:bg-stone-50 dark:hover:bg-stone-900")
                              )}
                            >
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                                  selected ? "border-rose-500 bg-rose-500 text-white" : "border-border"
                                )}
                              >
                                {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                              </span>
                              {o.text}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* 3. Multiple Select */}
                    {type === "multi_select" && (
                      <div className="mt-2.5 space-y-1.5">
                        <p className="text-xs text-muted-foreground font-medium mb-1">Select all correct options:</p>
                        {q.options.map((o) => {
                          const selected = (multiAnswers[q.id] || []).includes(o.id);
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => toggleMultiSelect(q.id, o.id)}
                              className={cn(
                                "flex w-full items-center gap-2.5 rounded-[8px] border px-3 py-2 text-left text-sm transition-colors",
                                selected
                                  ? "border-rose-400 bg-rose-50 dark:border-rose-600 dark:bg-rose-950/30"
                                  : cn(HAIRLINE, "hover:bg-rose-50/50 dark:hover:bg-rose-950/20")
                              )}
                            >
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border-2",
                                  selected ? "border-rose-500 bg-rose-500 text-white" : "border-border"
                                )}
                              >
                                {selected && <Check className="h-3 w-3" />}
                              </span>
                              {o.text}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* 4. Arrange in Order */}
                    {type === "ordering" && (
                      <div className="mt-2.5 space-y-1.5">
                        <p className="text-xs text-muted-foreground font-medium mb-1">
                          Use the Up / Down arrows to arrange items in the correct order:
                        </p>
                        {(orderingAnswers[q.id] || q.options).map((o, idx, list) => (
                          <div
                            key={o.id}
                            className={cn(
                              "flex items-center justify-between gap-2.5 rounded-[8px] border p-2.5 text-sm bg-background",
                              HAIRLINE
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold text-white">
                                {idx + 1}
                              </span>
                              <span className="font-medium truncate">{o.text}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moveOrderingItem(q.id, idx, "up")}
                                className="rounded-[6px] border border-border p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30"
                                title="Move up"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === list.length - 1}
                                onClick={() => moveOrderingItem(q.id, idx, "down")}
                                className="rounded-[6px] border border-border p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30"
                                title="Move down"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 5. Fill in the Blank */}
                    {type === "fill_in_blank" && (
                      <div className="mt-2.5">
                        <input
                          type="text"
                          value={textAnswers[q.id] || ""}
                          onChange={(e) => setTextAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                          placeholder="Type your answer here..."
                          className="w-full max-w-md rounded-[8px] border border-border bg-background px-3.5 py-2 text-sm outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-300"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
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
