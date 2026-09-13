"use client";

/**
 * Subject workspace tabs — Classes · Quizzes · Gradebook.
 *
 * Ported from Naseeha's course-page tab structure (see
 * `@/components/course/course-tabs`). The subject page used to stack the
 * lesson list and the quiz manager on one long scroll; a quiz authored below
 * the fold was easy to miss. Naseeha surfaces quizzes and grading as their own
 * tabs, so a Nisa subject now does too.
 *
 * This is presentation only: `LessonList`, `QuizManager` and `GradebookPanel`
 * are unchanged and receive exactly the props they always did. No query, no
 * write, and nothing touching `recording_url` lives here — it only chooses
 * which existing panel is on screen.
 */

import { useState } from "react";
import { BookOpen, FileQuestion, GraduationCap } from "lucide-react";
import { CourseTabs, type CourseTab } from "@/components/course/course-tabs";
import { LessonList } from "./lesson-list";
import { QuizManager, type ManagedQuiz } from "./quiz-manager";
import {
  GradebookPanel,
  type GbStudent,
  type GbAssessment,
  type GbQuiz,
  type GbGrade,
  type GbQuizScore,
} from "./gradebook-panel";
import type { Lesson, Resource } from "@/lib/types/database";

export interface GradebookData {
  students: GbStudent[];
  assessments: GbAssessment[];
  quizzes: GbQuiz[];
  grades: GbGrade[];
  quizScores: GbQuizScore[];
}

type SubjectTabKey = "classes" | "quizzes" | "gradebook";

export function SubjectTabs({
  subjectId,
  offeringId,
  lessons,
  initialResources,
  subjectRecurringMeetingUrl,
  quizzes,
  gradebook,
}: {
  subjectId: string;
  offeringId: string;
  lessons: Lesson[];
  initialResources: Resource[];
  subjectRecurringMeetingUrl?: string | null;
  quizzes: ManagedQuiz[];
  gradebook: GradebookData;
}) {
  const [active, setActive] = useState<SubjectTabKey>("classes");

  const tabs: readonly CourseTab<SubjectTabKey>[] = [
    { key: "classes", label: "Classes", icon: BookOpen },
    {
      key: "quizzes",
      label: quizzes.length > 0 ? `Quizzes · ${quizzes.length}` : "Quizzes",
      icon: FileQuestion,
    },
    { key: "gradebook", label: "Gradebook", icon: GraduationCap },
  ];

  return (
    <div className="space-y-5">
      <CourseTabs
        tabs={tabs}
        active={active}
        onChange={setActive}
        label="Subject section"
      />

      {active === "classes" && (
        <LessonList
          subjectId={subjectId}
          offeringId={offeringId}
          lessons={lessons}
          initialResources={initialResources}
          subjectRecurringMeetingUrl={subjectRecurringMeetingUrl}
        />
      )}

      {active === "quizzes" && (
        <QuizManager
          subjectId={subjectId}
          offeringId={offeringId}
          quizzes={quizzes}
        />
      )}

      {active === "gradebook" && (
        <GradebookPanel
          subjectId={subjectId}
          offeringId={offeringId}
          students={gradebook.students}
          assessments={gradebook.assessments}
          quizzes={gradebook.quizzes}
          grades={gradebook.grades}
          quizScores={gradebook.quizScores}
        />
      )}
    </div>
  );
}
