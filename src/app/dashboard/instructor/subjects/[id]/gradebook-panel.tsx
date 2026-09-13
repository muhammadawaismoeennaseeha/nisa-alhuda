"use client";

/**
 * Gradebook panel — the teacher's marks grid for one subject (Module 4).
 *
 * Rows are enrolled students; columns are gradable items. Quiz items come
 * from the quiz engine and are READ-ONLY here (percentage only). Manual
 * assessments are editable: type a mark, press Enter or tab away, it saves.
 * The last column is the subject total — the simple mean of every graded
 * item's percentage — with its letter grade.
 *
 * Nothing here can touch a quiz mark or a class recording; it only reads quiz
 * percentages and writes into assessment_grades via server actions.
 */
import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2, GraduationCap } from "lucide-react";
import {
  courseCard,
  courseButton,
  courseButtonPrimary,
} from "@/components/course/course-surface";
import { cn } from "@/lib/utils";
import {
  getLetterGrade,
  gradeBadgeClasses,
  marksToPct,
  subjectAveragePct,
} from "@/lib/utils/grades";
import {
  createAssessment,
  deleteAssessment,
  upsertGrade,
  type AssessmentInput,
} from "./gradebook-actions";

export interface GbStudent {
  id: string;
  full_name: string;
}
export interface GbAssessment {
  id: string;
  title: string;
  type: "assignment" | "exam" | "participation" | "custom";
  max_marks: number;
}
export interface GbQuiz {
  id: string;
  title: string;
}
export interface GbGrade {
  assessment_id: string;
  student_id: string;
  marks: number;
}
export interface GbQuizScore {
  quiz_id: string;
  student_id: string;
  percentage: number;
}

interface Props {
  subjectId: string;
  offeringId: string;
  students: GbStudent[];
  assessments: GbAssessment[];
  quizzes: GbQuiz[];
  grades: GbGrade[];
  quizScores: GbQuizScore[];
}

const TYPE_LABEL: Record<GbAssessment["type"], string> = {
  assignment: "Assignment",
  exam: "Exam",
  participation: "Participation",
  custom: "Custom",
};

function gradeKey(assessmentId: string, studentId: string) {
  return `${assessmentId}:${studentId}`;
}
function quizKey(quizId: string, studentId: string) {
  return `${quizId}:${studentId}`;
}

export function GradebookPanel({
  subjectId,
  offeringId,
  students,
  assessments,
  quizzes,
  grades,
  quizScores,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Local marks map so a cell reflects the typed value immediately; the
  // server action reconciles on the next render (revalidatePath).
  const initialMarks = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of grades) m.set(gradeKey(g.assessment_id, g.student_id), String(g.marks));
    return m;
  }, [grades]);
  const [marks, setMarks] = useState<Map<string, string>>(initialMarks);

  const quizPctMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of quizScores) m.set(quizKey(s.quiz_id, s.student_id), Number(s.percentage));
    return m;
  }, [quizScores]);

  function saveMark(assessmentId: string, studentId: string, raw: string) {
    const trimmed = raw.trim();
    const key = gradeKey(assessmentId, studentId);
    const before = initialMarks.get(key) ?? "";
    if (trimmed === before) return; // nothing changed
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError("Marks must be zero or more.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await upsertGrade(assessmentId, studentId, subjectId, value);
      if (!res.success) setError(res.error ?? "Could not save the mark.");
    });
  }

  function studentTotal(studentId: string): number | null {
    const items: (number | null)[] = [];
    for (const q of quizzes) {
      const p = quizPctMap.get(quizKey(q.id, studentId));
      items.push(p === undefined ? null : p);
    }
    for (const a of assessments) {
      const raw = marks.get(gradeKey(a.id, studentId));
      if (raw === undefined || raw.trim() === "") items.push(null);
      else items.push(marksToPct(Number(raw), a.max_marks));
    }
    return subjectAveragePct(items);
  }

  const noStudents = students.length === 0;
  const noItems = quizzes.length === 0 && assessments.length === 0;

  return (
    <div className="space-y-4">
      {/* Add-assessment control */}
      <div className={cn(courseCard, "flex flex-wrap items-center justify-between gap-3 px-[18px] py-3.5")}>
        <div className="flex items-center gap-2.5">
          <GraduationCap className="h-[18px] w-[18px] text-rose-500" />
          <div>
            <p className="text-[13.5px] font-medium text-stone-800 dark:text-stone-100">Gradebook</p>
            <p className="text-[12px] text-stone-500 dark:text-stone-400">
              Quiz results feed in automatically. Add assignments, exams, or participation marks below.
            </p>
          </div>
        </div>
        <button
          type="button"
          className={cn(courseButtonPrimary, "gap-1.5")}
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-4 w-4" /> Add assessment
        </button>
      </div>

      {adding && (
        <AddAssessmentForm
          subjectId={subjectId}
          offeringId={offeringId}
          onDone={() => setAdding(false)}
          onError={setError}
        />
      )}

      {error && (
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      )}

      {noStudents ? (
        <div className={cn(courseCard, "px-[18px] py-10 text-center text-[13.5px] text-stone-500 dark:text-stone-400")}>
          No students are enrolled on this offering yet.
        </div>
      ) : noItems ? (
        <div className={cn(courseCard, "px-[18px] py-10 text-center text-[13.5px] text-stone-500 dark:text-stone-400")}>
          No graded items yet. Publish a quiz, or add an assessment above.
        </div>
      ) : (
        <div className={cn(courseCard, "overflow-x-auto p-0")}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-stone-200 dark:border-stone-700">
                <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-medium text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                  Student
                </th>
                {quizzes.map((q) => (
                  <th key={q.id} className="min-w-[92px] px-3 py-3 text-center font-medium text-stone-600 dark:text-stone-300">
                    <span className="block truncate" title={q.title}>{q.title}</span>
                    <span className="text-[11px] font-normal text-rose-500">Quiz</span>
                  </th>
                ))}
                {assessments.map((a) => (
                  <th key={a.id} className="min-w-[104px] px-3 py-3 text-center font-medium text-stone-600 dark:text-stone-300">
                    <span className="flex items-center justify-center gap-1">
                      <span className="block truncate" title={a.title}>{a.title}</span>
                      <DeleteAssessmentButton assessmentId={a.id} subjectId={subjectId} title={a.title} onError={setError} />
                    </span>
                    <span className="text-[11px] font-normal text-stone-400">
                      {TYPE_LABEL[a.type]} · /{a.max_marks}
                    </span>
                  </th>
                ))}
                <th className="min-w-[96px] px-4 py-3 text-center font-medium text-stone-600 dark:text-stone-300">Total</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const total = studentTotal(s.id);
                return (
                  <tr key={s.id} className="border-b border-stone-100 last:border-0 dark:border-stone-800">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-stone-800 dark:bg-stone-900 dark:text-stone-100">
                      {s.full_name}
                    </td>
                    {quizzes.map((q) => {
                      const p = quizPctMap.get(quizKey(q.id, s.id));
                      return (
                        <td key={q.id} className="px-3 py-2.5 text-center">
                          {p === undefined ? (
                            <span className="text-stone-300 dark:text-stone-600">—</span>
                          ) : (
                            <span className={cn("inline-block rounded-full border px-2 py-0.5 text-[12px]", gradeBadgeClasses(p))}>
                              {p}%
                            </span>
                          )}
                        </td>
                      );
                    })}
                    {assessments.map((a) => {
                      const key = gradeKey(a.id, s.id);
                      return (
                        <td key={a.id} className="px-2 py-2 text-center">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            aria-label={`${s.full_name} — ${a.title}`}
                            disabled={pending}
                            value={marks.get(key) ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setMarks((prev) => {
                                const next = new Map(prev);
                                next.set(key, v);
                                return next;
                              });
                            }}
                            onBlur={(e) => saveMark(a.id, s.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            className="w-[68px] rounded-[8px] border border-stone-200 bg-white px-2 py-1 text-center text-[13px] text-stone-800 focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                          />
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-center">
                      {total === null ? (
                        <span className="text-stone-300 dark:text-stone-600">—</span>
                      ) : (
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12.5px] font-medium", gradeBadgeClasses(total))}>
                          {total}% · {getLetterGrade(total)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddAssessmentForm({
  subjectId,
  offeringId,
  onDone,
  onError,
}: {
  subjectId: string;
  offeringId: string;
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<AssessmentInput["type"]>("assignment");
  const [maxMarks, setMaxMarks] = useState("100");

  function submit() {
    onError(null);
    const input: AssessmentInput = { title, type, maxMarks: Number(maxMarks) };
    startTransition(async () => {
      const res = await createAssessment(subjectId, offeringId, input);
      if (!res.success) {
        onError(res.error ?? "Could not add the assessment.");
        return;
      }
      setTitle("");
      setMaxMarks("100");
      setType("assignment");
      onDone();
    });
  }

  return (
    <div className={cn(courseCard, "flex flex-wrap items-end gap-3 px-[18px] py-4")}>
      <label className="flex flex-col gap-1 text-[12px] text-stone-500 dark:text-stone-400">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Surah Al-Fatiha recitation"
          className="w-[220px] rounded-[8px] border border-stone-200 bg-white px-3 py-1.5 text-[13px] text-stone-800 focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-stone-500 dark:text-stone-400">
        Type
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AssessmentInput["type"])}
          className="rounded-[8px] border border-stone-200 bg-white px-3 py-1.5 text-[13px] text-stone-800 focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
        >
          <option value="assignment">Assignment</option>
          <option value="exam">Exam</option>
          <option value="participation">Participation</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-stone-500 dark:text-stone-400">
        Total marks
        <input
          type="number"
          min={1}
          step="0.01"
          value={maxMarks}
          onChange={(e) => setMaxMarks(e.target.value)}
          className="w-[100px] rounded-[8px] border border-stone-200 bg-white px-3 py-1.5 text-[13px] text-stone-800 focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
        />
      </label>
      <button type="button" disabled={pending} className={cn(courseButtonPrimary)} onClick={submit}>
        {pending ? "Adding…" : "Add"}
      </button>
      <button type="button" disabled={pending} className={cn(courseButton)} onClick={onDone}>
        Cancel
      </button>
    </div>
  );
}

function DeleteAssessmentButton({
  assessmentId,
  subjectId,
  title,
  onError,
}: {
  assessmentId: string;
  subjectId: string;
  title: string;
  onError: (msg: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  function remove() {
    if (!window.confirm(`Delete "${title}" and every mark on it? This can't be undone.`)) return;
    onError(null);
    startTransition(async () => {
      const res = await deleteAssessment(assessmentId, subjectId);
      if (!res.success) onError(res.error ?? "Could not delete the assessment.");
    });
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={remove}
      aria-label={`Delete ${title}`}
      className="text-stone-300 transition-colors hover:text-rose-500 dark:text-stone-600"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
