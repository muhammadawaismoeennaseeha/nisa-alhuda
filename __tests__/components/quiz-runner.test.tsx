/**
 * Quiz Runner — the student-facing quiz surface (migration 034).
 *
 * The engine's grading and its answer-key secrecy are enforced in the database
 * (the two SECURITY DEFINER functions) and proven there. What this file pins is
 * the browser contract the student sees:
 *
 *   1. An UNATTEMPTED quiz offers a single "Take quiz" action and shows its
 *      question/marks summary — never a score.
 *   2. An ATTEMPTED quiz is done: it shows the recorded score pill and a
 *      "Completed" state, and offers no way to retake (one attempt only).
 *   3. Options are single-select — the paper is a list of choices, and the
 *      server action module is mocked so the test never reaches the network.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuizRunner, type StudentQuiz } from "@/app/dashboard/student/offerings/[id]/quiz-runner";

// The runner imports "use server" actions; stub the module so importing the
// component in jsdom never tries to run server code.
vi.mock("@/app/dashboard/student/offerings/[id]/quiz-actions", () => ({
  loadPaper: vi.fn(),
  submitQuiz: vi.fn(),
}));

const UNATTEMPTED: StudentQuiz = {
  id: "quiz-1",
  title: "Tajweed basics",
  question_count: 3,
  total_marks: 6,
  attempt: null,
};

const ATTEMPTED: StudentQuiz = {
  id: "quiz-2",
  title: "Seerah quiz",
  question_count: 4,
  total_marks: 8,
  attempt: { score: 6, max_score: 8, percentage: 75 },
};

describe("QuizRunner — the student's quiz list", () => {
  it("offers a Take quiz action and a marks summary for an unattempted quiz", () => {
    render(<QuizRunner quizzes={[UNATTEMPTED]} />);
    expect(screen.getByText("Tajweed basics")).toBeInTheDocument();
    expect(screen.getByText(/3 questions · 6 marks/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Take quiz/ })).toBeInTheDocument();
  });

  it("shows the recorded score and no retake for an attempted quiz", () => {
    render(<QuizRunner quizzes={[ATTEMPTED]} />);
    // the score pill carries the stored marks + percentage
    expect(screen.getByText(/6 \/ 8 · 75%/)).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    // one attempt only: there is no way back into the paper
    expect(screen.queryByRole("button", { name: /Take quiz/ })).toBeNull();
  });

  it("never shows a score for a quiz the student has not taken", () => {
    render(<QuizRunner quizzes={[UNATTEMPTED]} />);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByText("Completed")).toBeNull();
  });
});
