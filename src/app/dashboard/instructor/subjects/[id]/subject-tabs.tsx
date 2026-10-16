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

import { useState, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
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
import { FileAssignmentManager } from "./file-assignment-manager";
import type { AssignmentPaperRow } from "./assignment-actions";
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
  fileAssignments = [],
  gradebook,
}: {
  subjectId: string;
  offeringId: string;
  lessons: Lesson[];
  initialResources: Resource[];
  subjectRecurringMeetingUrl?: string | null;
  quizzes: ManagedQuiz[];
  fileAssignments?: AssignmentPaperRow[];
  gradebook: GradebookData;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = searchParams.get("tab") as SubjectTabKey | null;
  const [active, setActive] = useState<SubjectTabKey>(
    tabParam === "quizzes" || tabParam === "gradebook" ? tabParam : "classes"
  );

  useEffect(() => {
    if (tabParam && (tabParam === "classes" || tabParam === "quizzes" || tabParam === "gradebook")) {
      setActive(tabParam);
    }
  }, [tabParam]);

  function handleTabChange(tab: SubjectTabKey) {
    setActive(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const totalAssessments = quizzes.length + fileAssignments.length;
  const tabs: readonly CourseTab<SubjectTabKey>[] = [
    { key: "classes", label: "Classes", icon: BookOpen },
    {
      key: "quizzes",
      label: totalAssessments > 0 ? `Quizzes & Papers · ${totalAssessments}` : "Quizzes",
      icon: FileQuestion,
    },
    { key: "gradebook", label: "Gradebook", icon: GraduationCap },
  ];

  return (
    <div className="space-y-5">
      <CourseTabs
        tabs={tabs}
        active={active}
        onChange={handleTabChange}
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
        <div className="space-y-6">
          <QuizManager
            subjectId={subjectId}
            offeringId={offeringId}
            quizzes={quizzes}
          />

          <FileAssignmentManager
            subjectId={subjectId}
            offeringId={offeringId}
            assignments={fileAssignments}
          />
        </div>
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
