"use client";

/**
 * Quiz Manager — the instructor's authoring surface & assessment view for built-in quizzes.
 *
 * Supports diverse auto-graded question types:
 *   - Multiple Choice (single selection)
 *   - True / False
 *   - Multiple Select (checkbox selection)
 *   - Arrange in Order (ordering sequence)
 *   - Fill in the Blank (text matching)
 *
 * Also provides a Teacher Assessment view for instructors to inspect student
 * attempts, detailed submissions, scores, and auto-graded results.
 */
import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardList,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Eye,
  EyeOff,
  Lock,
  ArrowUp,
  ArrowDown,
  Users,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Award,
  ChevronDown,
  ChevronUp,
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
import {
  createQuiz,
  updateQuizMeta,
  saveQuestions,
  setPublished,
  deleteQuiz,
  getQuizSubmissions,
  type QuizQuestionInput,
  type QuizSubmissionDetail,
} from "./quiz-actions";
import type { QuizQuestionType } from "@/lib/types/database";

export interface ManagedOption {
  id?: string;
  text: string;
  is_correct: boolean;
}

export interface ManagedQuestion {
  id?: string;
  text: string;
  marks: number;
  question_type: QuizQuestionType;
  options: ManagedOption[];
}

export interface ManagedQuiz {
  id: string;
  title: string;
  instructions: string | null;
  is_published: boolean;
  attempt_count: number;
  questions: ManagedQuestion[];
}

const HAIRLINE = "border-border-soft dark:border-border";

const QUESTION_TYPE_LABELS: Record<QuizQuestionType, string> = {
  multiple_choice: "Multiple Choice (Single)",
  true_false: "True / False",
  multi_select: "Multiple Select (Checkboxes)",
  ordering: "Arrange in Order",
  fill_in_blank: "Fill in the Blank",
};

function blankQuestion(type: QuizQuestionType = "multiple_choice"): ManagedQuestion {
  if (type === "true_false") {
    return {
      text: "",
      marks: 1,
      question_type: "true_false",
      options: [
        { text: "True", is_correct: true },
        { text: "False", is_correct: false },
      ],
    };
  }
  if (type === "ordering") {
    return {
      text: "",
      marks: 2,
      question_type: "ordering",
      options: [
        { text: "First item", is_correct: true },
        { text: "Second item", is_correct: true },
        { text: "Third item", is_correct: true },
      ],
    };
  }
  if (type === "fill_in_blank") {
    return {
      text: "",
      marks: 1,
      question_type: "fill_in_blank",
      options: [{ text: "", is_correct: true }],
    };
  }
  return {
    text: "",
    marks: 1,
    question_type: type,
    options: [
      { text: "", is_correct: true },
      { text: "", is_correct: false },
    ],
  };
}

export function QuizManager({
  subjectId,
  offeringId,
  quizzes,
}: {
  subjectId: string;
  offeringId: string;
  quizzes: ManagedQuiz[];
}) {
  const router = useRouter();
  const [localQuizzes, setLocalQuizzes] = useState<ManagedQuiz[]>(quizzes);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingSubmissionsQuiz, setViewingSubmissionsQuiz] = useState<ManagedQuiz | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ManagedQuiz | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Sync state when server props update, preserving any locally created/editing quiz
  useEffect(() => {
    setLocalQuizzes((prev) => {
      const serverIds = new Set(quizzes.map((q) => q.id));
      const unsyncedLocals = prev.filter((p) => !serverIds.has(p.id) && (p.id === editingId || p.questions.length === 0));
      return [...unsyncedLocals, ...quizzes];
    });
  }, [quizzes, editingId]);

  async function handleNew() {
    const title = window.prompt("Name this quiz", "New quiz")?.trim();
    if (!title) return;
    setBusyId("new");
    const res = await createQuiz(subjectId, offeringId, title);
    setBusyId(null);
    if (!res.success || !res.data) {
      toast.error(res.error ?? "Could not create quiz.");
      return;
    }
    toast.success("Quiz created — add your questions.");
    const newQuiz: ManagedQuiz = {
      id: res.data.id,
      title,
      instructions: null,
      is_published: false,
      attempt_count: 0,
      questions: [],
    };
    setLocalQuizzes((prev) => [newQuiz, ...prev.filter((q) => q.id !== res.data!.id)]);
    setEditingId(res.data.id);
    startTransition(() => router.refresh());
  }

  async function handleTogglePublish(q: ManagedQuiz) {
    setBusyId(q.id);
    const res = await setPublished(q.id, subjectId, !q.is_published);
    setBusyId(null);
    if (!res.success) {
      toast.error(res.error ?? "Could not update.");
      return;
    }
    toast.success(q.is_published ? "Quiz hidden from students." : "Quiz is now live for students.");
    startTransition(() => router.refresh());
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    const res = await deleteQuiz(pendingDelete.id, subjectId);
    setBusyId(null);
    setPendingDelete(null);
    if (!res.success) {
      toast.error(res.error ?? "Could not delete.");
      return;
    }
    toast.success("Quiz deleted.");
    startTransition(() => router.refresh());
  }

  return (
    <div className={cn(courseCard, "px-[18px] py-4")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-steel-50 text-steel-700 dark:bg-sky-950/50 dark:text-sky-300">
            <ClipboardList className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h2 className="font-heading text-[13.5px] font-semibold">Quizzes & Assessments</h2>
            <p className="text-xs text-muted-foreground">
              Create True/False, Multiple Choice, Ordering & Fill-in-the-Blank quizzes — auto-graded instantly upon student submission.
            </p>
          </div>
        </div>
        <button
          type="button"
          className={cn(courseButtonPrimary, "press")}
          onClick={handleNew}
          disabled={busyId === "new"}
        >
          <Plus className="h-4 w-4" />
          New quiz
        </button>
      </div>

      {localQuizzes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No quizzes yet. Create one and it stays a private draft until you publish it.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {localQuizzes.map((q) =>
            editingId === q.id ? (
              <QuizBuilder
                key={q.id}
                subjectId={subjectId}
                quiz={q}
                onClose={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  startTransition(() => router.refresh());
                }}
              />
            ) : (
              <div
                key={q.id}
                className={cn("flex flex-col gap-2 rounded-[10px] border p-3.5 sm:flex-row sm:items-center", HAIRLINE)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-[13.5px] font-semibold">{q.title}</span>
                    <span className={cn(pillBase, q.is_published ? pillTones.success : pillTones.muted)}>
                      {q.is_published ? "Published" : "Draft"}
                    </span>
                    {q.attempt_count > 0 && (
                      <span className={cn(pillBase, pillTones.steel, "inline-flex items-center gap-1")}>
                        <Lock className="h-3 w-3" />
                        {q.attempt_count} submission{q.attempt_count === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {q.questions.length} question{q.questions.length === 1 ? "" : "s"} ·{" "}
                    {q.questions.reduce((s, x) => s + Number(x.marks), 0)} marks
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {q.attempt_count > 0 && (
                    <button
                      type="button"
                      className={cn(courseButton, "press border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300")}
                      onClick={() => setViewingSubmissionsQuiz(q)}
                    >
                      <Users className="h-3.5 w-3.5" />
                      View Submissions ({q.attempt_count})
                    </button>
                  )}
                  <button
                    type="button"
                    className={cn(courseButton, "press")}
                    onClick={() => setEditingId(q.id)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    className={cn(courseButton, "press")}
                    onClick={() => handleTogglePublish(q)}
                    disabled={busyId === q.id}
                  >
                    {q.is_published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {q.is_published ? "Unpublish" : "Publish"}
                  </button>
                  <button
                    type="button"
                    className={cn(courseButton, courseButtonDanger, "press")}
                    onClick={() => setPendingDelete(q)}
                    disabled={busyId === q.id || q.attempt_count > 0}
                    title={q.attempt_count > 0 ? "Taken quizzes cannot be deleted" : "Delete quiz"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {viewingSubmissionsQuiz && (
        <SubmissionsViewModal
          quiz={viewingSubmissionsQuiz}
          onClose={() => setViewingSubmissionsQuiz(null)}
        />
      )}

      {pendingDelete && (
        <CourseConfirmDialog
          open
          onOpenChange={(open) => !open && setPendingDelete(null)}
          title="Delete this quiz?"
          confirmLabel="Delete quiz"
          onConfirm={confirmDelete}
          busy={busyId === pendingDelete.id}
        >
          <p>
            &ldquo;{pendingDelete.title}&rdquo; and all its questions will be
            removed. This cannot be undone.
          </p>
        </CourseConfirmDialog>
      )}
    </div>
  );
}

function QuizBuilder({
  subjectId,
  quiz,
  onClose,
  onSaved,
}: {
  subjectId: string;
  quiz: ManagedQuiz;
  onClose: () => void;
  onSaved: () => void;
}) {
  const locked = quiz.attempt_count > 0;
  const [title, setTitle] = useState(quiz.title);
  const [instructions, setInstructions] = useState(quiz.instructions ?? "");
  const [questions, setQuestions] = useState<ManagedQuestion[]>(
    quiz.questions.length ? structuredClone(quiz.questions) : [blankQuestion()]
  );
  const [saving, setSaving] = useState(false);

  function patchQuestion(i: number, patch: Partial<ManagedQuestion>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  function handleTypeChange(i: number, newType: QuizQuestionType) {
    setQuestions((qs) =>
      qs.map((q, idx) => {
        if (idx !== i) return q;
        const fresh = blankQuestion(newType);
        return {
          ...q,
          question_type: newType,
          options: fresh.options,
        };
      })
    );
  }

  function patchOption(qi: number, oi: number, patch: Partial<ManagedOption>) {
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx !== qi ? q : { ...q, options: q.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) }
      )
    );
  }

  function setSingleCorrect(qi: number, oi: number) {
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx !== qi ? q : { ...q, options: q.options.map((o, j) => ({ ...o, is_correct: j === oi })) }
      )
    );
  }

  function toggleMultiCorrect(qi: number, oi: number) {
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx !== qi
          ? q
          : {
              ...q,
              options: q.options.map((o, j) => (j === oi ? { ...o, is_correct: !o.is_correct } : o)),
            }
      )
    );
  }

  function moveOption(qi: number, oi: number, direction: "up" | "down") {
    setQuestions((qs) =>
      qs.map((q, idx) => {
        if (idx !== qi) return q;
        const newOpts = [...q.options];
        const targetIdx = direction === "up" ? oi - 1 : oi + 1;
        if (targetIdx < 0 || targetIdx >= newOpts.length) return q;
        const temp = newOpts[oi];
        newOpts[oi] = newOpts[targetIdx];
        newOpts[targetIdx] = temp;
        return { ...q, options: newOpts };
      })
    );
  }

  async function handleSave() {
    setSaving(true);
    const meta = await updateQuizMeta(quiz.id, subjectId, {
      title,
      instructions: instructions.trim() || null,
    });
    if (!meta.success) {
      setSaving(false);
      toast.error(meta.error ?? "Could not save.");
      return;
    }
    const payload: QuizQuestionInput[] = questions.map((q) => ({
      text: q.text,
      marks: Number(q.marks) || 0,
      question_type: q.question_type || "multiple_choice",
      options: q.options.map((o) => ({ text: o.text, is_correct: o.is_correct })),
    }));
    const res = await saveQuestions(quiz.id, subjectId, payload);
    setSaving(false);
    if (!res.success) {
      toast.error(res.error ?? "Could not save questions.");
      return;
    }
    toast.success("Quiz saved.");
    onSaved();
  }

  return (
    <div className={cn("rounded-[10px] border p-4", HAIRLINE)}>
      <div className="flex items-center justify-between gap-3">
        <input
          className="w-full max-w-md rounded-[8px] border border-border bg-background px-3 py-1.5 font-heading text-[14px] font-semibold outline-none focus:border-rose-300"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Quiz title"
        />
        <button type="button" className={cn(courseButton, "press")} onClick={onClose}>
          <X className="h-3.5 w-3.5" />
          Close
        </button>
      </div>

      <textarea
        className="mt-2 w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-rose-300"
        rows={2}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Instructions for students (optional)"
      />

      {locked && (
        <p className="mt-3 flex items-center gap-1.5 rounded-[8px] bg-steel-50 px-3 py-2 text-xs text-steel-700 dark:bg-sky-950/40 dark:text-sky-300">
          <Lock className="h-3.5 w-3.5" />
          {quiz.attempt_count} student{quiz.attempt_count === 1 ? " has" : "s have"} taken this quiz,
          so the questions are locked. You can still rename it and edit the instructions.
        </p>
      )}

      <div className="mt-3 space-y-4">
        {questions.map((q, qi) => {
          const type = q.question_type || "multiple_choice";
          return (
            <div key={qi} className={cn("rounded-[8px] border p-3.5", HAIRLINE)}>
              <div className="flex items-start gap-2">
                <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold text-white">
                  {qi + 1}
                </span>
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-[8px] border border-border bg-background px-2.5 py-1 text-xs font-semibold text-stone-700 outline-none focus:border-rose-300 dark:text-stone-200 disabled:opacity-70"
                      value={type}
                      disabled={locked}
                      onChange={(e) => handleTypeChange(qi, e.target.value as QuizQuestionType)}
                    >
                      <option value="multiple_choice">Multiple Choice (Single)</option>
                      <option value="true_false">True / False</option>
                      <option value="multi_select">Multiple Select (Checkboxes)</option>
                      <option value="ordering">Arrange in Order</option>
                      <option value="fill_in_blank">Fill in the Blank</option>
                    </select>
                    <span className="text-[11px] text-muted-foreground">
                      {type === "multiple_choice" && "Students pick 1 correct option."}
                      {type === "true_false" && "Students choose True or False."}
                      {type === "multi_select" && "Students select all applicable options."}
                      {type === "ordering" && "Set items in exact target order. System auto-checks sequence."}
                      {type === "fill_in_blank" && "System matches typed text against acceptable answers."}
                    </span>
                  </div>

                  <textarea
                    className="w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-rose-300 disabled:opacity-70"
                    rows={2}
                    value={q.text}
                    disabled={locked}
                    onChange={(e) => patchQuestion(qi, { text: e.target.value })}
                    placeholder={
                      type === "fill_in_blank"
                        ? "Prompt, e.g.: The Holy Quran contains ____ Surahs."
                        : type === "ordering"
                        ? "Prompt, e.g.: Arrange these Surahs in chronological order of revelation."
                        : "Question text"
                    }
                  />
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    className="w-16 rounded-[8px] border border-border bg-background px-2 py-2 text-sm outline-none focus:border-rose-300 disabled:opacity-70"
                    value={q.marks}
                    disabled={locked}
                    onChange={(e) => patchQuestion(qi, { marks: Number(e.target.value) })}
                    title="Marks"
                  />
                  {!locked && questions.length > 1 && (
                    <button
                      type="button"
                      className={cn(courseButton, courseButtonDanger, "press h-9 w-9 justify-center px-0")}
                      onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== qi))}
                      title="Remove question"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* ── Option Editors per Question Type ── */}
              <div className="mt-3 pl-8 space-y-2">
                {/* 1. Multiple Choice (Single) */}
                {type === "multiple_choice" && (
                  <div className="space-y-1.5">
                    {q.options.map((o, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => !locked && setSingleCorrect(qi, oi)}
                          disabled={locked}
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                            o.is_correct
                              ? "border-sage-700 bg-sage-700 text-white dark:border-emerald-600 dark:bg-emerald-600"
                              : "border-border"
                          )}
                          title={o.is_correct ? "Correct answer" : "Mark correct"}
                        >
                          {o.is_correct && <Check className="h-3 w-3" />}
                        </button>
                        <input
                          className="w-full rounded-[8px] border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-rose-300 disabled:opacity-70"
                          value={o.text}
                          disabled={locked}
                          onChange={(e) => patchOption(qi, oi, { text: e.target.value })}
                          placeholder={`Option ${oi + 1}`}
                        />
                        {!locked && q.options.length > 2 && (
                          <button
                            type="button"
                            className="shrink-0 text-muted-foreground hover:text-rose-600"
                            onClick={() =>
                              patchQuestion(qi, { options: q.options.filter((_, j) => j !== oi) })
                            }
                            title="Remove option"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    {!locked && (
                      <button
                        type="button"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700"
                        onClick={() =>
                          patchQuestion(qi, { options: [...q.options, { text: "", is_correct: false }] })
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Add option
                      </button>
                    )}
                  </div>
                )}

                {/* 2. True / False */}
                {type === "true_false" && (
                  <div className="flex gap-4">
                    {q.options.map((o, oi) => (
                      <label
                        key={oi}
                        className={cn(
                          "flex flex-1 items-center gap-2.5 rounded-[8px] border px-3 py-2 cursor-pointer transition-colors",
                          o.is_correct
                            ? "border-sage-400 bg-sage-50 text-sage-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 font-semibold"
                            : "border-border hover:bg-stone-50 dark:hover:bg-stone-900"
                        )}
                      >
                        <input
                          type="radio"
                          name={`tf-${qi}`}
                          checked={o.is_correct}
                          disabled={locked}
                          onChange={() => setSingleCorrect(qi, oi)}
                          className="h-4 w-4 accent-sage-700"
                        />
                        <span className="text-sm">{o.text}</span>
                        {o.is_correct && <span className="ml-auto text-xs text-sage-700 dark:text-emerald-400 font-bold">(Correct)</span>}
                      </label>
                    ))}
                  </div>
                )}

                {/* 3. Multiple Select */}
                {type === "multi_select" && (
                  <div className="space-y-1.5">
                    {q.options.map((o, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => !locked && toggleMultiCorrect(qi, oi)}
                          disabled={locked}
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border-2 transition-colors",
                            o.is_correct
                              ? "border-sage-700 bg-sage-700 text-white dark:border-emerald-600 dark:bg-emerald-600"
                              : "border-border"
                          )}
                          title={o.is_correct ? "Correct answer" : "Mark as correct option"}
                        >
                          {o.is_correct && <Check className="h-3.5 w-3.5" />}
                        </button>
                        <input
                          className="w-full rounded-[8px] border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-rose-300 disabled:opacity-70"
                          value={o.text}
                          disabled={locked}
                          onChange={(e) => patchOption(qi, oi, { text: e.target.value })}
                          placeholder={`Option ${oi + 1}`}
                        />
                        {!locked && q.options.length > 2 && (
                          <button
                            type="button"
                            className="shrink-0 text-muted-foreground hover:text-rose-600"
                            onClick={() =>
                              patchQuestion(qi, { options: q.options.filter((_, j) => j !== oi) })
                            }
                            title="Remove option"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    {!locked && (
                      <button
                        type="button"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700"
                        onClick={() =>
                          patchQuestion(qi, { options: [...q.options, { text: "", is_correct: false }] })
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Add option
                      </button>
                    )}
                  </div>
                )}

                {/* 4. Arrange in Order */}
                {type === "ordering" && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground mb-1 font-medium">
                      Enter items in their exact correct sequence (1st, 2nd, 3rd...). Students will see them shuffled.
                    </p>
                    {q.options.map((o, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[11px] font-bold text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                          {oi + 1}
                        </span>
                        <input
                          className="w-full rounded-[8px] border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-rose-300 disabled:opacity-70"
                          value={o.text}
                          disabled={locked}
                          onChange={(e) => patchOption(qi, oi, { text: e.target.value, is_correct: true })}
                          placeholder={`Step / Item ${oi + 1}`}
                        />
                        {!locked && (
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              disabled={oi === 0}
                              onClick={() => moveOption(qi, oi, "up")}
                              className="rounded p-1 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30"
                              title="Move up"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={oi === q.options.length - 1}
                              onClick={() => moveOption(qi, oi, "down")}
                              className="rounded p-1 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30"
                              title="Move down"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            {q.options.length > 2 && (
                              <button
                                type="button"
                                className="p-1 text-muted-foreground hover:text-rose-600"
                                onClick={() =>
                                  patchQuestion(qi, { options: q.options.filter((_, j) => j !== oi) })
                                }
                                title="Remove item"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {!locked && (
                      <button
                        type="button"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700"
                        onClick={() =>
                          patchQuestion(qi, { options: [...q.options, { text: "", is_correct: true }] })
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Add item
                      </button>
                    )}
                  </div>
                )}

                {/* 5. Fill in the Blank */}
                {type === "fill_in_blank" && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground mb-1 font-medium">
                      Enter acceptable correct answer(s) (case-insensitive). Add multiple if synonyms are allowed.
                    </p>
                    {q.options.map((o, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-sage-700 dark:text-emerald-400 shrink-0" />
                        <input
                          className="w-full rounded-[8px] border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-rose-300 disabled:opacity-70"
                          value={o.text}
                          disabled={locked}
                          onChange={(e) => patchOption(qi, oi, { text: e.target.value, is_correct: true })}
                          placeholder={oi === 0 ? "Correct answer (e.g. 114)" : "Alternative answer (e.g. one hundred fourteen)"}
                        />
                        {!locked && q.options.length > 1 && (
                          <button
                            type="button"
                            className="shrink-0 text-muted-foreground hover:text-rose-600"
                            onClick={() =>
                              patchQuestion(qi, { options: q.options.filter((_, j) => j !== oi) })
                            }
                            title="Remove answer variant"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    {!locked && (
                      <button
                        type="button"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700"
                        onClick={() =>
                          patchQuestion(qi, { options: [...q.options, { text: "", is_correct: true }] })
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Add alternative answer
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!locked && (
        <button
          type="button"
          className={cn(courseButton, "press mt-3")}
          onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add question
        </button>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={cn(courseButton, "press")} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={cn(courseButtonPrimary, "press")}
          onClick={handleSave}
          disabled={saving}
        >
          <Check className="h-4 w-4" />
          {saving ? "Saving…" : "Save quiz"}
        </button>
      </div>
    </div>
  );
}

function SubmissionsViewModal({
  quiz,
  onClose,
}: {
  quiz: ManagedQuiz;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState<QuizSubmissionDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null);

  useState(() => {
    getQuizSubmissions(quiz.id).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setSubmissions(res.data);
      } else {
        setError(res.error ?? "Could not load submissions.");
      }
    });
  });

  const totalAttempts = submissions.length;
  const avgScore = totalAttempts > 0 ? (submissions.reduce((s, a) => s + a.percentage, 0) / totalAttempts).toFixed(1) : 0;
  const passCount = submissions.filter((a) => a.percentage >= 60).length;
  const passRate = totalAttempts > 0 ? Math.round((passCount / totalAttempts) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-3xl rounded-[12px] border border-border bg-background p-6 shadow-xl my-8">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <span className={cn(pillBase, pillTones.steel, "mb-1 inline-block")}>Teacher Assessment</span>
            <h3 className="font-heading text-lg font-bold">{quiz.title}</h3>
            <p className="text-xs text-muted-foreground">Student Submissions & Auto-Graded Results</p>
          </div>
          <button type="button" className={cn(courseButton, "press")} onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Loading student submissions…
          </div>
        ) : error ? (
          <div className="my-4 rounded-[8px] bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </div>
        ) : submissions.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No students have taken this quiz yet.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Stats Summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-[10px] border border-border p-3 text-center bg-stone-50 dark:bg-stone-900">
                <p className="text-xs text-muted-foreground">Total Submissions</p>
                <p className="font-heading text-lg font-bold text-stone-800 dark:text-stone-100">{totalAttempts}</p>
              </div>
              <div className="rounded-[10px] border border-border p-3 text-center bg-stone-50 dark:bg-stone-900">
                <p className="text-xs text-muted-foreground">Class Average</p>
                <p className="font-heading text-lg font-bold text-sage-700 dark:text-emerald-400">{avgScore}%</p>
              </div>
              <div className="rounded-[10px] border border-border p-3 text-center bg-stone-50 dark:bg-stone-900">
                <p className="text-xs text-muted-foreground">Pass Rate</p>
                <p className="font-heading text-lg font-bold text-rose-600">{passRate}%</p>
              </div>
            </div>

            {/* Submissions List */}
            <div className="space-y-2">
              {submissions.map((sub) => {
                const isExpanded = expandedAttemptId === sub.attempt_id;
                const pass = sub.percentage >= 60;
                return (
                  <div key={sub.attempt_id} className="rounded-[10px] border border-border overflow-hidden">
                    <div
                      className="flex items-center justify-between p-3.5 bg-background cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/50"
                      onClick={() => setExpandedAttemptId(isExpanded ? null : sub.attempt_id)}
                    >
                      <div className="flex items-center gap-3">
                        {pass ? (
                          <CheckCircle2 className="h-5 w-5 text-sage-700 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="h-5 w-5 text-rose-500 shrink-0" />
                        )}
                        <div>
                          <p className="text-sm font-semibold">{sub.student_name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Submitted on {new Date(sub.submitted_at).toLocaleString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={cn(pillBase, pass ? pillTones.success : pillTones.brand, "text-xs font-bold")}>
                          {sub.score} / {sub.max_score} ({sub.percentage}%)
                        </span>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>

                    {/* Detailed Paper Inspection */}
                    {isExpanded && (
                      <div className="border-t border-border bg-stone-50 p-4 dark:bg-stone-900/60 space-y-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Detailed Student Answers Breakdown
                        </h4>
                        {sub.answers.map((ans, idx) => (
                          <div key={ans.question_id} className="rounded-[8px] border border-border bg-background p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2">
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                                  {idx + 1}
                                </span>
                                <div>
                                  <p className="text-xs font-semibold">{ans.question_text}</p>
                                  <span className="text-[10px] text-muted-foreground font-medium">
                                    Type: {QUESTION_TYPE_LABELS[ans.question_type] || ans.question_type} · {ans.marks} mark{ans.marks === 1 ? "" : "s"}
                                  </span>
                                </div>
                              </div>
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold", ans.is_correct ? pillTones.success : pillTones.brand)}>
                                {ans.is_correct ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                                {ans.is_correct ? `+${ans.marks} marks` : "0 marks"}
                              </span>
                            </div>

                            {/* Render Answer Response detail based on question type */}
                            <div className="mt-2.5 pl-7 text-xs space-y-1.5">
                              {/* 1. Multiple Choice / True False */}
                              {(ans.question_type === "multiple_choice" || ans.question_type === "true_false") && (
                                <div>
                                  <span className="text-muted-foreground">Student selected: </span>
                                  {ans.selected_option_id ? (
                                    <span className={cn("font-medium", ans.is_correct ? "text-sage-800 dark:text-emerald-300" : "text-rose-600")}>
                                      {ans.options.find((o) => o.id === ans.selected_option_id)?.text || "Unknown Option"}
                                    </span>
                                  ) : (
                                    <span className="italic text-muted-foreground">No answer submitted</span>
                                  )}
                                  {!ans.is_correct && (
                                    <p className="text-[11px] text-sage-700 dark:text-emerald-400 font-medium mt-0.5">
                                      Correct answer: {ans.options.find((o) => o.is_correct)?.text}
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* 2. Multiple Select */}
                              {ans.question_type === "multi_select" && (
                                <div>
                                  <span className="text-muted-foreground">Student selected: </span>
                                  {ans.selected_option_ids && ans.selected_option_ids.length > 0 ? (
                                    <span className="font-medium">
                                      {ans.selected_option_ids
                                        .map((id) => ans.options.find((o) => o.id === id)?.text)
                                        .filter(Boolean)
                                        .join(", ")}
                                    </span>
                                  ) : (
                                    <span className="italic text-muted-foreground">No selections</span>
                                  )}
                                  {!ans.is_correct && (
                                    <p className="text-[11px] text-sage-700 dark:text-emerald-400 font-medium mt-0.5">
                                      Correct selections: {ans.options.filter((o) => o.is_correct).map((o) => o.text).join(", ")}
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* 3. Fill in the Blank */}
                              {ans.question_type === "fill_in_blank" && (
                                <div>
                                  <span className="text-muted-foreground">Student typed: </span>
                                  {ans.text_answer ? (
                                    <span className={cn("font-mono font-medium", ans.is_correct ? "text-sage-800 dark:text-emerald-300" : "text-rose-600")}>
                                      &ldquo;{ans.text_answer}&rdquo;
                                    </span>
                                  ) : (
                                    <span className="italic text-muted-foreground">Empty response</span>
                                  )}
                                  {!ans.is_correct && (
                                    <p className="text-[11px] text-sage-700 dark:text-emerald-400 font-medium mt-0.5">
                                      Acceptable answers: {ans.options.map((o) => `"${o.text}"`).join(" or ")}
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* 4. Ordering */}
                              {ans.question_type === "ordering" && (
                                <div>
                                  <span className="text-muted-foreground">Submitted Sequence: </span>
                                  {ans.ordered_option_ids && ans.ordered_option_ids.length > 0 ? (
                                    <ol className="mt-1 list-decimal list-inside space-y-0.5 font-medium">
                                      {ans.ordered_option_ids.map((id) => (
                                        <li key={id}>{ans.options.find((o) => o.id === id)?.text}</li>
                                      ))}
                                    </ol>
                                  ) : (
                                    <span className="italic text-muted-foreground">Not ordered</span>
                                  )}
                                  {!ans.is_correct && (
                                    <div className="mt-1 text-[11px] text-sage-700 dark:text-emerald-400">
                                      <p className="font-semibold">Correct sequence:</p>
                                      <ol className="list-decimal list-inside space-y-0.5">
                                        {ans.options.map((o) => (
                                          <li key={o.id}>{o.text}</li>
                                        ))}
                                      </ol>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
