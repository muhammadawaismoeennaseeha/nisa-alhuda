/**
 * Transcript engine (Module 5) — the single source of truth for turning a
 * student's gradebook into a whole-record transcript.
 *
 * A transcript aggregates, across every approved enrollment:
 *   offering -> subjects -> graded items (quizzes + manual assessments).
 * Each subject's percentage is the SAME simple-mean rule the gradebook uses
 * (see src/lib/utils/grades.ts) — so a transcript can never disagree with the
 * gradebook it is built from. Per the agreed scale, every graded SUBJECT
 * carries equal weight in the offering and cumulative averages; ungraded
 * subjects are shown but left out of the mean.
 *
 * `buildTranscript` is pure (data in, structure out) so it is trivially
 * testable. `fetchTranscriptForStudent` does the IO and hands the pure builder
 * normalized rows. Both the live student view, the live staff view, and the
 * "issue official transcript" action call `fetchTranscriptForStudent`, so all
 * three produce byte-identical figures.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  subjectAveragePct,
  marksToPct,
  getLetterGrade,
} from "@/lib/utils/grades";

export type TranscriptItemKind = "quiz" | "assessment";

export interface TranscriptItem {
  kind: TranscriptItemKind;
  label: string;
  /** "Quiz", or the capitalized assessment type ("Exam", "Assignment"…). */
  typeLabel: string;
  /** Percentage earned, or null when not attempted / not yet marked. */
  percentage: number | null;
  /** Human detail, e.g. "18/20", "Not attempted", "Not marked". */
  detail: string;
}

export interface TranscriptSubject {
  subjectId: string;
  title: string;
  items: TranscriptItem[];
  /** Simple mean of the subject's graded items, or null if none graded. */
  pct: number | null;
  letter: string | null;
}

export interface TranscriptOffering {
  offeringId: string;
  title: string;
  subjects: TranscriptSubject[];
  /** Simple mean of this offering's graded subjects. */
  pct: number | null;
  letter: string | null;
}

export interface TranscriptData {
  studentId: string;
  studentName: string;
  offerings: TranscriptOffering[];
  /** Simple mean of EVERY graded subject across all offerings, equal weight. */
  cumulativePct: number | null;
  cumulativeLetter: string | null;
  gradedSubjectCount: number;
  totalSubjectCount: number;
}

/** Normalized rows the pure builder consumes. */
export interface TranscriptInput {
  studentId: string;
  studentName: string;
  offerings: { id: string; title: string }[];
  subjects: { id: string; title: string; offering_id: string }[];
  quizzes: { id: string; subject_id: string; title: string }[];
  /** Keyed by quiz_id — this student's attempt, if any. */
  attempts: Record<string, { score: number; max_score: number; percentage: number }>;
  assessments: {
    id: string;
    subject_id: string;
    title: string;
    type: string;
    max_marks: number;
  }[];
  /** Keyed by assessment_id — this student's mark, if any. */
  marks: Record<string, number>;
}

function letterOf(pct: number | null): string | null {
  return pct === null ? null : getLetterGrade(pct);
}

/**
 * Pure: build the transcript structure from normalized rows. No IO, no client.
 * Offerings and subjects are emitted in the order given (callers pass them
 * pre-sorted). Offerings with no subjects are dropped; subjects are kept even
 * when ungraded so the record shows the full programme.
 */
export function buildTranscript(input: TranscriptInput): TranscriptData {
  const quizzesBySubject = new Map<string, TranscriptInput["quizzes"]>();
  for (const q of input.quizzes) {
    const list = quizzesBySubject.get(q.subject_id) ?? [];
    list.push(q);
    quizzesBySubject.set(q.subject_id, list);
  }
  const assessmentsBySubject = new Map<string, TranscriptInput["assessments"]>();
  for (const a of input.assessments) {
    const list = assessmentsBySubject.get(a.subject_id) ?? [];
    list.push(a);
    assessmentsBySubject.set(a.subject_id, list);
  }
  const subjectsByOffering = new Map<string, TranscriptInput["subjects"]>();
  for (const s of input.subjects) {
    const list = subjectsByOffering.get(s.offering_id) ?? [];
    list.push(s);
    subjectsByOffering.set(s.offering_id, list);
  }

  const allSubjectPcts: (number | null)[] = [];
  const offerings: TranscriptOffering[] = [];
  let gradedSubjectCount = 0;
  let totalSubjectCount = 0;

  for (const off of input.offerings) {
    const subjectRows = subjectsByOffering.get(off.id) ?? [];
    if (subjectRows.length === 0) continue;

    const subjects: TranscriptSubject[] = subjectRows.map((s) => {
      const items: TranscriptItem[] = [];

      for (const q of quizzesBySubject.get(s.id) ?? []) {
        const attempt = input.attempts[q.id];
        items.push({
          kind: "quiz",
          label: q.title,
          typeLabel: "Quiz",
          percentage: attempt ? attempt.percentage : null,
          detail: attempt
            ? `${attempt.score}/${attempt.max_score}`
            : "Not attempted",
        });
      }

      for (const a of assessmentsBySubject.get(s.id) ?? []) {
        const mark = input.marks[a.id];
        const has = mark !== undefined;
        items.push({
          kind: "assessment",
          label: a.title,
          typeLabel: a.type.charAt(0).toUpperCase() + a.type.slice(1),
          percentage: has ? marksToPct(mark, a.max_marks) : null,
          detail: has ? `${mark}/${a.max_marks}` : "Not marked",
        });
      }

      const pct = subjectAveragePct(items.map((i) => i.percentage));
      totalSubjectCount += 1;
      if (pct !== null) gradedSubjectCount += 1;
      allSubjectPcts.push(pct);

      return { subjectId: s.id, title: s.title, items, pct, letter: letterOf(pct) };
    });

    const offeringPct = subjectAveragePct(subjects.map((s) => s.pct));
    offerings.push({
      offeringId: off.id,
      title: off.title,
      subjects,
      pct: offeringPct,
      letter: letterOf(offeringPct),
    });
  }

  const cumulativePct = subjectAveragePct(allSubjectPcts);

  return {
    studentId: input.studentId,
    studentName: input.studentName,
    offerings,
    cumulativePct,
    cumulativeLetter: letterOf(cumulativePct),
    gradedSubjectCount,
    totalSubjectCount,
  };
}

/**
 * Fetch + build a student's live transcript. Pass an RLS-scoped client for a
 * student reading their own record (they may only ever see their own rows), or
 * a service-role admin client for a staff member viewing/issuing another
 * student's — always gate the caller by role first. `studentName` is looked up
 * when not supplied.
 */
export async function fetchTranscriptForStudent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  studentId: string,
  studentName?: string
): Promise<TranscriptData> {
  const empty = (name: string): TranscriptData => ({
    studentId,
    studentName: name,
    offerings: [],
    cumulativePct: null,
    cumulativeLetter: null,
    gradedSubjectCount: 0,
    totalSubjectCount: 0,
  });

  let name = studentName ?? "";
  if (!name) {
    const { data: prof } = await client
      .from("profiles")
      .select("full_name")
      .eq("id", studentId)
      .single();
    name = prof?.full_name ?? "Student";
  }

  // Approved enrollments -> the offerings that make up the record.
  const { data: enrollRows } = await client
    .from("enrollments")
    .select("offering:offerings!enrollments_offering_id_fkey(id, title)")
    .eq("student_id", studentId)
    .eq("status", "approved");

  const offeringsById = new Map<string, { id: string; title: string }>();
  for (const r of (enrollRows ?? []) as {
    offering: { id: string; title: string } | { id: string; title: string }[] | null;
  }[]) {
    const off = Array.isArray(r.offering) ? r.offering[0] ?? null : r.offering;
    if (off && !offeringsById.has(off.id)) offeringsById.set(off.id, off);
  }
  const offerings = [...offeringsById.values()];
  if (offerings.length === 0) return empty(name);
  const offeringIds = offerings.map((o) => o.id);

  // Subjects across those offerings, in display order.
  const { data: subjectRows } = await client
    .from("subjects")
    .select("id, title, offering_id, sort_order")
    .in("offering_id", offeringIds)
    .order("sort_order", { ascending: true });
  const subjects = (subjectRows ?? []) as {
    id: string;
    title: string;
    offering_id: string;
  }[];
  const subjectIds = subjects.map((s) => s.id);
  if (subjectIds.length === 0) {
    // Offerings exist but no subjects yet — nothing to grade.
    return {
      ...empty(name),
      offerings: offerings.map((o) => ({
        offeringId: o.id,
        title: o.title,
        subjects: [],
        pct: null,
        letter: null,
      })),
    };
  }

  // Published quizzes on those offerings + this student's own attempts.
  const { data: quizRows } = await client
    .from("quizzes")
    .select("id, subject_id, title")
    .in("offering_id", offeringIds)
    .eq("is_published", true);
  const quizzes = (quizRows ?? []) as {
    id: string;
    subject_id: string;
    title: string;
  }[];
  const quizIds = quizzes.map((q) => q.id);

  const attempts: TranscriptInput["attempts"] = {};
  if (quizIds.length > 0) {
    const { data: attemptRows } = await client
      .from("quiz_attempts")
      .select("quiz_id, score, max_score, percentage")
      .eq("student_id", studentId)
      .in("quiz_id", quizIds);
    for (const a of (attemptRows ?? []) as {
      quiz_id: string;
      score: number;
      max_score: number;
      percentage: number;
    }[]) {
      attempts[a.quiz_id] = {
        score: Number(a.score),
        max_score: Number(a.max_score),
        percentage: Number(a.percentage),
      };
    }
  }

  // Manual assessments on those subjects + this student's own marks.
  const { data: assessmentRows } = await client
    .from("assessments")
    .select("id, subject_id, title, type, max_marks")
    .in("subject_id", subjectIds)
    .order("sort_order", { ascending: true });
  const assessments = (assessmentRows ?? []) as {
    id: string;
    subject_id: string;
    title: string;
    type: string;
    max_marks: number;
  }[];
  const assessmentIds = assessments.map((a) => a.id);

  const marks: TranscriptInput["marks"] = {};
  if (assessmentIds.length > 0) {
    const { data: markRows } = await client
      .from("assessment_grades")
      .select("assessment_id, marks")
      .eq("student_id", studentId)
      .in("assessment_id", assessmentIds);
    for (const g of (markRows ?? []) as {
      assessment_id: string;
      marks: number;
    }[]) {
      marks[g.assessment_id] = Number(g.marks);
    }
  }

  return buildTranscript({
    studentId,
    studentName: name,
    offerings,
    subjects,
    quizzes,
    attempts,
    assessments: assessments.map((a) => ({ ...a, max_marks: Number(a.max_marks) })),
    marks,
  });
}
