import { describe, it, expect } from "vitest";
import {
  round2,
  getLetterGrade,
  subjectAveragePct,
  marksToPct,
  gradeBadgeClasses,
  LETTER_BANDS,
} from "@/lib/utils/grades";

describe("round2()", () => {
  it("rounds to two decimals", () => {
    expect(round2(89.666)).toBe(89.67);
    expect(round2(90)).toBe(90);
    expect(round2(33.333333)).toBe(33.33);
  });
});

describe("getLetterGrade()", () => {
  it("maps each band's lower bound to its letter", () => {
    expect(getLetterGrade(97)).toBe("A+");
    expect(getLetterGrade(93)).toBe("A");
    expect(getLetterGrade(90)).toBe("A-");
    expect(getLetterGrade(87)).toBe("B+");
    expect(getLetterGrade(83)).toBe("B");
    expect(getLetterGrade(80)).toBe("B-");
    expect(getLetterGrade(70)).toBe("C-");
    expect(getLetterGrade(60)).toBe("D-");
    expect(getLetterGrade(59.99)).toBe("F");
    expect(getLetterGrade(0)).toBe("F");
  });

  it("keeps A+ above 100 and F below 0", () => {
    expect(getLetterGrade(120)).toBe("A+");
    expect(getLetterGrade(-5)).toBe("F");
  });

  it("every band resolves to a defined letter", () => {
    for (const b of LETTER_BANDS) {
      expect(getLetterGrade(b.min)).toBe(b.letter);
    }
  });
});

describe("marksToPct()", () => {
  it("converts marks over a max to a percentage", () => {
    expect(marksToPct(18, 20)).toBe(90);
    expect(marksToPct(1, 3)).toBe(33.33);
  });
  it("allows extra credit above 100%", () => {
    expect(marksToPct(22, 20)).toBe(110);
  });
  it("guards a zero or absent max", () => {
    expect(marksToPct(5, 0)).toBe(0);
    expect(marksToPct(5, -1)).toBe(0);
  });
});

describe("subjectAveragePct()", () => {
  it("returns null when nothing is graded", () => {
    expect(subjectAveragePct([])).toBeNull();
    expect(subjectAveragePct([null, null])).toBeNull();
  });
  it("averages only the graded items, ignoring nulls", () => {
    // 100, 90, 80 present; two ungraded items excluded → mean 90
    expect(subjectAveragePct([100, null, 90, 80, null])).toBe(90);
  });
  it("rounds the mean to two decimals", () => {
    expect(subjectAveragePct([100, 90, 82])).toBe(90.67);
  });
  it("a real zero counts (it is not the same as ungraded)", () => {
    expect(subjectAveragePct([0, 100])).toBe(50);
  });
});

describe("gradeBadgeClasses()", () => {
  it("returns a muted style for an ungraded total", () => {
    expect(gradeBadgeClasses(null)).toContain("stone");
  });
  it("uses distinct styles across the bands", () => {
    expect(gradeBadgeClasses(95)).toContain("sage");
    expect(gradeBadgeClasses(75)).toContain("amber");
    expect(gradeBadgeClasses(40)).toContain("rose");
  });
});
