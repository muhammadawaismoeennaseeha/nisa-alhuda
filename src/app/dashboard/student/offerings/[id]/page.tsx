/**
 * Student Learning Hub — the main learning page for an enrolled offering.
 * Shows subjects with expandable lessons, live class links, and recordings.
 * Only accessible to students with approved enrollment.
 *
 * Phase 4 re-skins this onto the shared course vocabulary in
 * `@/components/course` — the same header, cards and surfaces the admin course
 * workspace uses — so a course looks like one thing from both sides.
 *
 * Recordings are read-only here: `recording_url` is selected as part of
 * `lessons.*` and handed to `SubjectAccordion`, which renders the watch
 * affordances. Nothing on this route writes that column.
 */
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  CalendarDays,
  BookOpen,
  PlayCircle,
  Video,
  Clock,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CoursePageHeader } from "@/components/course/course-page-header";
import { MetricCard } from "@/components/course/course-cards";
import {
  courseButtonPrimary,
  courseCard,
} from "@/components/course/course-surface";
import { SubjectAccordion } from "./subject-accordion";
import type { StudentQuiz } from "./quiz-runner";
import {
  subjectAveragePct,
  marksToPct as gradePct,
} from "@/lib/utils/grades";
import {
  StudentCourseTabs,
  type SubjectQuizzes,
  type StudentSubjectGrades,
  type StudentGradeItem,
} from "./student-course-tabs";
import { MonthlyPaymentCard } from "./monthly-payment-card";
import { monthlyAmountForEnrollment } from "@/lib/monthly-payments";
import {
  computeNextOccurrence,
  hasRecurringSchedule,
  isLiveNow,
} from "@/lib/recurring-schedule";
import type {
  Subject,
  Lesson,
  MonthlyPayment,
  Offering,
  Enrollment,
  Resource,
} from "@/lib/types/database";
import { partitionLessons } from "@/lib/resource-helpers";

type SubjectWithInstructor = Subject & {
  instructor: { full_name: string } | null;
};

const TYPE_LABEL: Record<string, string> = {
  program: "Program",
  course: "Course",
  workshop: "Workshop",
};

function formatDay(value: string | Date) {
  return new Date(value).toLocaleDateString("en-PK", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function StudentLearningHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Verify student has an approved enrollment for this offering. We also
  // pull payment_currency + created_at + fa_approved_amount because the
  // monthly-payment card needs them to compute due cycles and the renewal
  // amount — FA-approved students pay a reduced fee in the same currency.
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, status, payment_currency, fa_approved_amount, created_at")
    .eq("student_id", user.id)
    .eq("offering_id", id)
    .single<
      Pick<
        Enrollment,
        | "id"
        | "status"
        | "payment_currency"
        | "fa_approved_amount"
        | "created_at"
      >
    >();

  if (!enrollment || enrollment.status !== "approved") {
    notFound();
  }

  // Fetch offering details
  const { data: offering } = await supabase
    .from("offerings")
    .select("*")
    .eq("id", id)
    .single<Offering>();

  if (!offering) notFound();

  // Monthly subscription: pull every cycle payment on this enrollment so the
  // card can render status per month. Only fetched for monthly-fee offerings.
  let monthlyPayments: MonthlyPayment[] = [];
  if (offering.fee_type === "monthly") {
    const { data: mp } = await supabase
      .from("monthly_payments")
      .select("*")
      .eq("enrollment_id", enrollment.id)
      .order("cycle_month", { ascending: false });
    monthlyPayments = (mp as MonthlyPayment[]) || [];
  }
  const monthly = monthlyAmountForEnrollment(offering, enrollment);

  // Fetch subjects for this offering with instructor info
  const { data: subjects } = await supabase
    .from("subjects")
    .select("*, instructor:profiles(full_name)")
    .eq("offering_id", id)
    .order("sort_order", { ascending: true });

  // Fetch all published lessons for this offering. We'll partition each
  // subject's lessons into "Resources" (no schedule + no live link → just
  // a holder for downloadable files) and "Classes" (real scheduled or
  // live-linked sessions). Resources are surfaced as a separate top
  // block per subject; Classes go in the lesson list.
  const { data: lessons } = await supabase
    .from("lessons")
    .select("*")
    .eq("offering_id", id)
    .eq("is_published", true)
    .order("sort_order", { ascending: true });

  const allLessons: Lesson[] = (lessons as Lesson[]) || [];

  // Group lessons by subject, then split into Resources vs Classes.
  const lessonsBySubject: Record<string, Lesson[]> = {};
  allLessons.forEach((lesson) => {
    const sid = lesson.subject_id || "__no_subject__";
    if (!lessonsBySubject[sid]) lessonsBySubject[sid] = [];
    lessonsBySubject[sid].push(lesson);
  });

  const classLessonsBySubject: Record<string, Lesson[]> = {};
  const resourceLessonIdsBySubject: Record<string, string[]> = {};
  for (const [sid, ls] of Object.entries(lessonsBySubject)) {
    const { resourceLessons, classLessons } = partitionLessons(ls);
    classLessonsBySubject[sid] = classLessons;
    resourceLessonIdsBySubject[sid] = resourceLessons.map((l) => l.id);
  }

  // Pull every resource attached to any of the resource-holder lessons
  // across the offering, in one shot. We then group them per subject so
  // the accordion can show them under the Resources heading.
  const allResourceLessonIds = Object.values(resourceLessonIdsBySubject).flat();
  const resourcesBySubject: Record<string, Resource[]> = {};
  if (allResourceLessonIds.length > 0) {
    const { data: resourcesRows } = await supabase
      .from("resources")
      .select("*")
      .in("lesson_id", allResourceLessonIds)
      .order("created_at", { ascending: false });
    const lessonIdToSubject: Record<string, string> = {};
    for (const [sid, ids] of Object.entries(resourceLessonIdsBySubject)) {
      for (const id of ids) lessonIdToSubject[id] = sid;
    }
    for (const r of (resourcesRows as Resource[]) || []) {
      const sid = lessonIdToSubject[r.lesson_id];
      if (!sid) continue;
      if (!resourcesBySubject[sid]) resourcesBySubject[sid] = [];
      resourcesBySubject[sid].push(r);
    }
  }

  // The "lessons" the student sees as actual classes excludes resource
  // holders — counts and progress should only consider real classes.
  const classLessonsFlat = Object.values(classLessonsBySubject).flat();
  const totalLessons = classLessonsFlat.length;

  // Fetch student's progress for this offering
  const { data: progress } = await supabase
    .from("lesson_progress")
    .select("lesson_id")
    .eq("student_id", user.id)
    .eq("offering_id", id);

  const completedLessonIds = (progress || []).map(
    (p: { lesson_id: string }) => p.lesson_id
  );
  const completedCount = completedLessonIds.length;
  const completionPct =
    totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  // Determine upcoming lesson — only real classes can be "upcoming".
  const now = new Date();
  const upcomingLesson = classLessonsFlat.find(
    (l) => l.scheduled_at && new Date(l.scheduled_at) > now
  );

  const typedSubjects = (subjects || []) as SubjectWithInstructor[];

  // ── Built-in quizzes the student can take (published only; migration 034). ──
  // The answer key is never fetched here; only titles, marks and this
  // student's own attempt score.
  const { data: quizRows } = await supabase
    .from("quizzes")
    .select("id, subject_id, title, quiz_questions(marks)")
    .eq("offering_id", id)
    .eq("is_published", true);

  const publishedQuizIds = (quizRows ?? []).map((q: { id: string }) => q.id);
  const attemptByQuiz: Record<
    string,
    { score: number; max_score: number; percentage: number }
  > = {};
  if (publishedQuizIds.length > 0) {
    const { data: myAttempts } = await supabase
      .from("quiz_attempts")
      .select("quiz_id, score, max_score, percentage")
      .eq("student_id", user.id)
      .in("quiz_id", publishedQuizIds);
    for (const a of (myAttempts as {
      quiz_id: string;
      score: number;
      max_score: number;
      percentage: number;
    }[]) ?? []) {
      attemptByQuiz[a.quiz_id] = {
        score: Number(a.score),
        max_score: Number(a.max_score),
        percentage: Number(a.percentage),
      };
    }
  }

  const quizzesBySubject: Record<string, StudentQuiz[]> = {};
  for (const q of (quizRows as {
    id: string;
    subject_id: string;
    title: string;
    quiz_questions: { marks: number }[];
  }[]) ?? []) {
    const qs = q.quiz_questions ?? [];
    (quizzesBySubject[q.subject_id] ??= []).push({
      id: q.id,
      title: q.title,
      question_count: qs.length,
      total_marks: qs.reduce((sum, x) => sum + Number(x.marks), 0),
      attempt: attemptByQuiz[q.id] ?? null,
    });
  }

  // Quizzes grouped by subject for the student Quizzes tab — only subjects
  // that actually have a published quiz appear. `typedSubjects` order is kept
  // so the tab reads top-to-bottom like the Materials accordion.
  const studentQuizGroups: SubjectQuizzes[] = typedSubjects
    .map((s) => ({
      subjectId: s.id,
      subjectTitle: s.title,
      quizzes: quizzesBySubject[s.id] ?? [],
    }))
    .filter((g) => g.quizzes.length > 0);


  // ── Grades (module 4): this student's own record per subject. ──
  // Blends quiz percentages (already loaded above) with manual assessment
  // marks. RLS returns only THIS student's marks (assessment_grades) and the
  // assessments on offerings they're enrolled in. Read-only.
  const subjectIds = typedSubjects.map((s) => s.id);
  const { data: gradeAssessmentRows } = await supabase
    .from("assessments")
    .select("id, subject_id, title, type, max_marks")
    .in("subject_id", subjectIds.length > 0 ? subjectIds : ["00000000-0000-0000-0000-000000000000"])
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const assessmentsBySubject: Record<string, {
    id: string;
    title: string;
    type: string;
    max_marks: number;
  }[]> = {};
  const gradeAssessmentIds: string[] = [];
  for (const a of (gradeAssessmentRows ?? []) as {
    id: string;
    subject_id: string;
    title: string;
    type: string;
    max_marks: number;
  }[]) {
    gradeAssessmentIds.push(a.id);
    (assessmentsBySubject[a.subject_id] ??= []).push({
      id: a.id,
      title: a.title,
      type: a.type,
      max_marks: Number(a.max_marks),
    });
  }
  const myMarkByAssessment: Record<string, number> = {};
  if (gradeAssessmentIds.length > 0) {
    const { data: myMarkRows } = await supabase
      .from("assessment_grades")
      .select("assessment_id, marks")
      .eq("student_id", user.id)
      .in("assessment_id", gradeAssessmentIds);
    for (const g of (myMarkRows ?? []) as { assessment_id: string; marks: number }[]) {
      myMarkByAssessment[g.assessment_id] = Number(g.marks);
    }
  }

  const gradeGroups: StudentSubjectGrades[] = typedSubjects
    .map((s) => {
      const items: StudentGradeItem[] = [];
      for (const q of quizzesBySubject[s.id] ?? []) {
        items.push({
          kind: "quiz",
          label: q.title,
          typeLabel: "Quiz",
          percentage: q.attempt ? q.attempt.percentage : null,
          detail: q.attempt
            ? `${q.attempt.score}/${q.attempt.max_score}`
            : "Not attempted",
        });
      }
      for (const a of assessmentsBySubject[s.id] ?? []) {
        const marks = myMarkByAssessment[a.id];
        const has = marks !== undefined;
        items.push({
          kind: "assessment",
          label: a.title,
          typeLabel:
            a.type.charAt(0).toUpperCase() + a.type.slice(1),
          percentage: has ? gradePct(marks, a.max_marks) : null,
          detail: has ? `${marks}/${a.max_marks}` : "Not marked",
        });
      }
      return {
        subjectId: s.id,
        subjectTitle: s.title,
        items,
        total: subjectAveragePct(items.map((i) => i.percentage)),
      };
    })
    .filter((g) => g.items.length > 0);


  // ── Header + metric derivations (all read-only) ──

  // How many classes have a recording the student can watch. Counting
  // `recording_url` never writes it; this is the same read the accordion does.
  const recordingsAvailable = classLessonsFlat.filter(
    (l) => l.recording_url
  ).length;

  // "Ustadha Maryam · Ustadha Hafsa · Jan 5, 2026 — Jun 30, 2026"
  const instructorNames = Array.from(
    new Set(
      typedSubjects
        .map((s) => s.instructor?.full_name)
        .filter((n): n is string => !!n)
    )
  );
  const dateRange = offering.schedule_start
    ? `${formatDay(offering.schedule_start)}${
        offering.schedule_end ? ` — ${formatDay(offering.schedule_end)}` : ""
      }`
    : null;
  const context =
    [instructorNames.join(" · "), dateRange].filter(Boolean).join(" · ") ||
    undefined;

  // The soonest live class across the course: every subject's recurring slot
  // plus the next dated lesson, whichever lands first.
  const nextLiveAt = [
    ...typedSubjects
      .filter(hasRecurringSchedule)
      .map((s) => computeNextOccurrence(s, now)?.start ?? null),
    upcomingLesson?.live_class_link && upcomingLesson.scheduled_at
      ? new Date(upcomingLesson.scheduled_at)
      : null,
  ]
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const nextLiveLabel = nextLiveAt
    ? nextLiveAt.toLocaleDateString("en-PK", {
        timeZone: "Asia/Karachi",
        weekday: "short",
      })
    : "—";

  // A header "Join live class" button only while a class is actually in
  // progress. Outside that window the per-subject card stays the single,
  // day-gated Join — a course-level button that is always clickable would
  // hand students a link to a meeting that isn't running.
  const liveSubject = typedSubjects.find((s) => isLiveNow(s, now));

  return (
    <div>
      <CoursePageHeader
        backHref="/dashboard/student"
        backLabel="My Learning"
        name={offering.title}
        context={context}
        description={offering.short_description}
        badges={[
          { label: "Enrolled", tone: "success" },
          { label: TYPE_LABEL[offering.type] ?? "Course", tone: "brand" },
        ]}
        actions={
          liveSubject && (
            <a
              href={liveSubject.recurring_meeting_url!}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(courseButtonPrimary, "press")}
            >
              <Video className="h-4 w-4" />
              Join live class
            </a>
          )
        }
      />

      {/* Monthly subscription card — renders only for monthly-fee offerings */}
      {offering.fee_type === "monthly" && (
        <div className="mt-5">
          <MonthlyPaymentCard
            enrollmentId={enrollment.id}
            enrolledAt={enrollment.created_at}
            monthlyAmount={monthly.amount}
            currency={monthly.currency}
            payments={monthlyPayments}
          />
        </div>
      )}

      {/* WhatsApp Group — prominent banner for enrolled students */}
      {offering.whatsapp_link && (
        <a
          href={offering.whatsapp_link}
          target="_blank"
          rel="noopener noreferrer"
          className="press mt-5 flex items-center gap-3 rounded-[var(--radius)] border border-[#25D366]/30 bg-gradient-to-r from-[#25D366]/10 via-[#128C7E]/5 to-transparent px-4 py-3 transition-all hover:border-[#25D366]/60 hover:shadow-sm"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#25D366]">
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#128C7E]">
              Join WhatsApp Group
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Stay connected with your sisters and instructor in our class group.
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-[#128C7E]">
            Open &rarr;
          </span>
        </a>
      )}

      {/* Metric strip — the mockup's three student cards, on Nisa's data. */}
      <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <MetricCard
          icon={BookOpen}
          value={`${completedCount}/${totalLessons}`}
          label={
            totalLessons > 0
              ? `Lessons watched · ${completionPct}%`
              : "Lessons watched"
          }
        />
        <MetricCard
          icon={PlayCircle}
          value={recordingsAvailable}
          label="Recordings available"
          tint="success"
        />
        <MetricCard
          icon={CalendarDays}
          value={nextLiveLabel}
          label="Next live class"
          tint="warning"
        />
      </div>

      {/* Upcoming class notice */}
      {upcomingLesson && upcomingLesson.live_class_link && (
        <div
          className={cn(
            courseCard,
            "mt-5 flex flex-col gap-3 p-[18px] sm:flex-row sm:items-center"
          )}
        >
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-sand-50 text-sand-700 dark:bg-amber-950/50 dark:text-amber-300">
            <Clock className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              Upcoming: {upcomingLesson.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(upcomingLesson.scheduled_at!).toLocaleString("en-PK", {
                timeZone: "Asia/Karachi",
                weekday: "long",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <a
            href={upcomingLesson.live_class_link}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(courseButtonPrimary, "press justify-center")}
          >
            <Video className="h-4 w-4" />
            Join Class
          </a>
        </div>
      )}

      {/* Subjects & Lessons */}
      <div className="mt-5">
        {typedSubjects.length === 0 ? (
          <div
            className={cn(
              courseCard,
              "flex flex-col items-center justify-center px-[18px] py-12 text-center"
            )}
          >
            <div className="mb-3.5 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-rose-50 text-rose-500 dark:bg-rose-950/50 dark:text-rose-300">
              <BookOpen className="h-[18px] w-[18px]" />
            </div>
            <p className="font-heading text-[15px] font-semibold">
              Content coming soon
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your instructor is preparing the lessons. Check back soon!
            </p>
          </div>
        ) : (
          <StudentCourseTabs quizGroups={studentQuizGroups} gradeGroups={gradeGroups}>
            <SubjectAccordion
              subjects={typedSubjects}
              lessonsBySubject={classLessonsBySubject}
              resourcesBySubject={resourcesBySubject}
              completedLessonIds={completedLessonIds}
              offeringId={id}
              // Quizzes now live in the Quizzes tab, not inline in the
              // accordion — pass an empty map so they are not shown twice.
              quizzesBySubject={{}}
            />
          </StudentCourseTabs>
        )}
      </div>
    </div>
  );
}
