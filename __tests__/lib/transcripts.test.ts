import { describe, it, expect } from "vitest";
import { buildTranscript, type TranscriptInput } from "@/lib/transcripts";

/** A base input: one offering, two subjects, no grades. Spread + override. */
function baseInput(over: Partial<TranscriptInput> = {}): TranscriptInput {
  return {
    studentId: "stu-1",
    studentName: "Aisha Fatima",
    offerings: [{ id: "off-1", title: "Qur'an Foundations" }],
    subjects: [
      { id: "sub-a", title: "Hadith Memorization", offering_id: "off-1" },
      { id: "sub-b", title: "Tajweed", offering_id: "off-1" },
    ],
    quizzes: [],
    attempts: {},
    assessments: [],
    marks: {},
    ...over,
  };
}

describe("buildTranscript() — the worked gradebook example", () => {
  it("blends a quiz and an assessment into a subject, then a cumulative", () => {
    const data = buildTranscript(
      baseInput({
        subjects: [
          { id: "sub-a", title: "Hadith Memorization", offering_id: "off-1" },
        ],
        quizzes: [{ id: "q1", subject_id: "sub-a", title: "Week 1 Quiz" }],
        attempts: { q1: { score: 18, max_score: 20, percentage: 90 } },
        assessments: [
          {
            id: "a1",
            subject_id: "sub-a",
            title: "Participation",
            type: "participation",
            max_marks: 10,
          },
        ],
        marks: { a1: 8 }, // 8/10 = 80%
      })
    );
    const subject = data.offerings[0].subjects[0];
    expect(subject.pct).toBe(85); // mean of 90 and 80
    expect(subject.letter).toBe("B");
    expect(data.cumulativePct).toBe(85);
    expect(data.cumulativeLetter).toBe("B");
    expect(data.gradedSubjectCount).toBe(1);
    expect(data.totalSubjectCount).toBe(1);
    // Item detail strings match the gradebook's presentation.
    expect(subject.items.map((i) => i.detail)).toEqual(["18/20", "8/10"]);
    expect(subject.items.map((i) => i.typeLabel)).toEqual(["Quiz", "Participation"]);
  });
});

describe("buildTranscript() — ungraded handling", () => {
  it("shows ungraded items but excludes them from every average", () => {
    const data = buildTranscript(
      baseInput({
        quizzes: [{ id: "q1", subject_id: "sub-a", title: "Unattempted" }],
        attempts: {}, // not attempted
        assessments: [
          { id: "a1", subject_id: "sub-a", title: "Exam", type: "exam", max_marks: 100 },
          { id: "a2", subject_id: "sub-b", title: "Essay", type: "assignment", max_marks: 50 },
        ],
        marks: { a1: 100 }, // sub-a graded 100%; sub-b unmarked
      })
    );
    const [subA, subB] = data.offerings[0].subjects;
    expect(subA.pct).toBe(100); // the unattempted quiz is ignored
    expect(subA.items.find((i) => i.kind === "quiz")?.percentage).toBeNull();
    expect(subA.items.find((i) => i.kind === "quiz")?.detail).toBe("Not attempted");
    expect(subB.pct).toBeNull(); // nothing marked -> "—"
    expect(subB.letter).toBeNull();
    // cumulative = mean of graded subjects only -> just sub-a
    expect(data.cumulativePct).toBe(100);
    expect(data.gradedSubjectCount).toBe(1);
    expect(data.totalSubjectCount).toBe(2);
  });

  it("returns nulls when nothing is graded anywhere", () => {
    const data = buildTranscript(baseInput());
    expect(data.cumulativePct).toBeNull();
    expect(data.cumulativeLetter).toBeNull();
    expect(data.gradedSubjectCount).toBe(0);
    expect(data.totalSubjectCount).toBe(2);
  });
});

describe("buildTranscript() — weighting across subjects and offerings", () => {
  it("weights every graded subject equally, not by item count", () => {
    // sub-a: 3 quizzes averaging 60; sub-b: 1 assessment at 100.
    // Subject-equal weighting => cumulative = mean(60, 100) = 80,
    // NOT the item-weighted mean of (60,60,60,100)=70.
    const data = buildTranscript(
      baseInput({
        quizzes: [
          { id: "q1", subject_id: "sub-a", title: "Q1" },
          { id: "q2", subject_id: "sub-a", title: "Q2" },
          { id: "q3", subject_id: "sub-a", title: "Q3" },
        ],
        attempts: {
          q1: { score: 6, max_score: 10, percentage: 60 },
          q2: { score: 6, max_score: 10, percentage: 60 },
          q3: { score: 6, max_score: 10, percentage: 60 },
        },
        assessments: [
          { id: "a1", subject_id: "sub-b", title: "Final", type: "exam", max_marks: 10 },
        ],
        marks: { a1: 10 },
      })
    );
    expect(data.offerings[0].subjects[0].pct).toBe(60);
    expect(data.offerings[0].subjects[1].pct).toBe(100);
    expect(data.offerings[0].pct).toBe(80);
    expect(data.cumulativePct).toBe(80);
  });

  it("cumulative spans multiple offerings, each subject equal weight", () => {
    const data = buildTranscript({
      studentId: "s",
      studentName: "S",
      offerings: [
        { id: "off-1", title: "Course One" },
        { id: "off-2", title: "Course Two" },
      ],
      subjects: [
        { id: "s1", title: "S1", offering_id: "off-1" },
        { id: "s2", title: "S2", offering_id: "off-2" },
      ],
      quizzes: [],
      attempts: {},
      assessments: [
        { id: "a1", subject_id: "s1", title: "T", type: "exam", max_marks: 100 },
        { id: "a2", subject_id: "s2", title: "T", type: "exam", max_marks: 100 },
      ],
      marks: { a1: 70, a2: 90 },
    });
    expect(data.offerings).toHaveLength(2);
    expect(data.cumulativePct).toBe(80); // mean(70, 90)
  });

  it("drops offerings that have no subjects", () => {
    const data = buildTranscript(
      baseInput({
        offerings: [
          { id: "off-1", title: "Has subjects" },
          { id: "off-empty", title: "No subjects" },
        ],
      })
    );
    expect(data.offerings.map((o) => o.offeringId)).toEqual(["off-1"]);
  });
});
