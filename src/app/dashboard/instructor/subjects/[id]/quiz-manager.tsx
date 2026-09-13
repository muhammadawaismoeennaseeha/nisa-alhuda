"use client";

/**
 * Quiz Manager — the instructor's authoring surface for the built-in quiz
 * engine, rendered on the Subject Folder page beneath the external quiz banner.
 *
 * It lists every quiz on the subject and, for one open at a time, a compact
 * builder: title, instructions, and a set of single-answer multiple-choice
 * questions. All writes go through the audited server actions in
 * `quiz-actions.ts`; this file holds no data logic and never sees a student's
 * marks. Once a quiz has been taken its structure is locked (the server
 * refuses the edit too), so the builder switches to a read-only note.
 */
import { useState, useTransition } from "react";
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
  type QuizQuestionInput,
} from "./quiz-actions";

export interface ManagedOption {
  id?: string;
  text: string;
  is_correct: boolean;
}
export interface ManagedQuestion {
  id?: string;
  text: string;
  marks: number;
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

function blankQuestion(): ManagedQuestion {
  return {
    text: "",
    marks: 1,
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ManagedQuiz | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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
            <h2 className="font-heading text-[13.5px] font-semibold">Quizzes</h2>
            <p className="text-xs text-muted-foreground">
              Auto-graded multiple-choice, marked the moment a student submits.
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

      {quizzes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No quizzes yet. Create one and it stays a private draft until you publish it.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {quizzes.map((q) =>
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
                        {q.attempt_count} taken · locked
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {q.questions.length} question{q.questions.length === 1 ? "" : "s"} ·{" "}
                    {q.questions.reduce((s, x) => s + Number(x.marks), 0)} marks
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
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
  function patchOption(qi: number, oi: number, patch: Partial<ManagedOption>) {
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx !== qi ? q : { ...q, options: q.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) }
      )
    );
  }
  function setCorrect(qi: number, oi: number) {
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx !== qi ? q : { ...q, options: q.options.map((o, j) => ({ ...o, is_correct: j === oi })) }
      )
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

      <div className="mt-3 space-y-3">
        {questions.map((q, qi) => (
          <div key={qi} className={cn("rounded-[8px] border p-3", HAIRLINE)}>
            <div className="flex items-start gap-2">
              <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold text-white">
                {qi + 1}
              </span>
              <textarea
                className="w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-rose-300 disabled:opacity-70"
                rows={1}
                value={q.text}
                disabled={locked}
                onChange={(e) => patchQuestion(qi, { text: e.target.value })}
                placeholder="Question text"
              />
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

            <div className="mt-2 space-y-1.5 pl-8">
              {q.options.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => !locked && setCorrect(qi, oi)}
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
                  <Plus className="h-3.5 w-3.5" />
                  Add option
                </button>
              )}
            </div>
          </div>
        ))}
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
