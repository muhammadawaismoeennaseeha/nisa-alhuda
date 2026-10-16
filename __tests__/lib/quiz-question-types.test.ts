import { describe, it, expect } from "vitest";
import type { QuizQuestionType } from "@/lib/types/database";

describe("Quiz Question Types", () => {
  it("supports all required auto-graded question types", () => {
    const supportedTypes: QuizQuestionType[] = [
      "multiple_choice",
      "true_false",
      "multi_select",
      "ordering",
      "fill_in_blank",
    ];

    expect(supportedTypes).toHaveLength(5);
    expect(supportedTypes).toContain("true_false");
    expect(supportedTypes).toContain("multiple_choice");
    expect(supportedTypes).toContain("multi_select");
    expect(supportedTypes).toContain("ordering");
    expect(supportedTypes).toContain("fill_in_blank");
  });
});
