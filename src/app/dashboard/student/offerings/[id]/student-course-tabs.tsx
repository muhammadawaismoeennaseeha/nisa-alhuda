"use client";

/**
 * Student course tabs — Materials · Quizzes · Grades.
 *
 * Ported from Naseeha's student course page, which splits what a student reads
 * (materials) from what a student sits (quizzes), and gives a student their own
 * grade record. Nisa used to fold the built-in quizzes inside each subject
 * accordion, where they were easy to miss; this lifts them into their own tab
 * that mirrors Naseeha, and adds a read-only Grades tab (module 4).
 *
 * Presentation only. The `children` slot is the existing `SubjectAccordion`
 * (the Materials view), rendered by the server and simply shown or hidden here.
 * The Quizzes view reuses the unchanged `QuizRunner` per subject. The Grades
 * view only renders numbers the server already computed — it never fetches,
 * grades, or writes.
 */

import { useState } from "react";
import { BookOpen, FileQuestion, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { CourseTabs, type CourseTab } from "@/components/course/course-tabs";
import { courseCard } from "@/components/course/course-surface";
import { getLetterGrade, gradeBadgeClasses } from "@/lib/utils/grades";
import { QuizRunner, type StudentQuiz } from "./quiz-runner";

export interface SubjectQuizzes {
  subjectId: string;
  subjectTitle: string;
  quizzes: StudentQuiz[];
}

export interface StudentGradeItem {
  kind: "quiz" | "assessment";
  label: string;
  typeLabel: string;
  /** null when not attempted / not marked yet. */
  percentage: number | null;
  /** e.g. "18/20" or "Not marked". */
  detail: string;
}
export interface StudentSubjectGrades {
  subjectId: string;
  subjectTitle: string;
  items: StudentGradeItem[];
  /** Simple mean of graded items, or null when nothing is graded yet. */
  total: number | null;
}

type TabKey = "materials" | "quizzes" | "grades";

export function StudentCourseTabs({
  quizGroups,
  gradeGroups,
  children,
}: {
  quizGroups: SubjectQuizzes[];
  gradeGroups: StudentSubjectGrades[];
  children: React.ReactNode;
}) {
  const [active, setActive] = useState<TabKey>("materials");
  const quizCount = quizGroups.reduce((n, g) => n + g.quizzes.length, 0);

  const tabs: readonly CourseTab<TabKey>[] = [
    { key: "materials", label: "Materials", icon: BookOpen },
    {
      key: "quizzes",
      label: quizCount > 0 ? `Quizzes · ${quizCount}` : "Quizzes",
      icon: FileQuestion,
    },
    { key: "grades", label: "Grades", icon: GraduationCap },
  ];

  return (
    <div className="space-y-5">
      <CourseTabs
        tabs={tabs}
        active={active}
        onChange={setActive}
        label="Course section"
      />

      {active === "materials" && children}

      {active === "quizzes" &&
        (quizCount === 0 ? (
          <div
            className={cn(
              courseCard,
              "flex flex-col items-center justify-center px-[18px] py-12 text-center"
            )}
          >
            <div className="mb-3.5 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-steel-50 text-steel-700 dark:bg-sky-950/50 dark:text-sky-300">
              <FileQuestion className="h-[18px] w-[18px]" />
            </div>
            <p className="font-heading text-[15px] font-semibold">
              No quizzes yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              When your instructor publishes a quiz, it will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {quizGroups
              .filter((g) => g.quizzes.length > 0)
              .map((g) => (
                <div key={g.subjectId} className="space-y-3">
                  <h3 className="font-heading text-[15px] font-semibold">
                    {g.subjectTitle}
                  </h3>
                  <QuizRunner quizzes={g.quizzes} />
                </div>
              ))}
          </div>
        ))}

      {active === "grades" && <GradesView groups={gradeGroups} />}
    </div>
  );
}

function GradesView({ groups }: { groups: StudentSubjectGrades[] }) {
  if (groups.length === 0) {
    return (
      <div
        className={cn(
          courseCard,
          "flex flex-col items-center justify-center px-[18px] py-12 text-center"
        )}
      >
        <div className="mb-3.5 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
          <GraduationCap className="h-[18px] w-[18px]" />
        </div>
        <p className="font-heading text-[15px] font-semibold">No grades yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your marks appear here as your instructor grades quizzes and
          assessments.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.subjectId} className={cn(courseCard, "p-0")}>
          <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-[18px] py-3.5 dark:border-stone-700">
            <h3 className="font-heading text-[15px] font-semibold">
              {g.subjectTitle}
            </h3>
            {g.total === null ? (
              <span className="text-[12.5px] text-stone-400">Not graded yet</span>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12.5px] font-medium",
                  gradeBadgeClasses(g.total)
                )}
              >
                {g.total}% · {getLetterGrade(g.total)}
              </span>
            )}
          </div>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {g.items.map((it, i) => (
              <li
                key={`${it.kind}-${i}`}
                className="flex items-center justify-between gap-3 px-[18px] py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-stone-800 dark:text-stone-100">
                    {it.label}
                  </p>
                  <p className="text-[12px] text-stone-500 dark:text-stone-400">
                    {it.typeLabel} · {it.detail}
                  </p>
                </div>
                {it.percentage === null ? (
                  <span className="shrink-0 text-[12.5px] text-stone-300 dark:text-stone-600">
                    —
                  </span>
                ) : (
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[12px]",
                      gradeBadgeClasses(it.percentage)
                    )}
                  >
                    {it.percentage}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
