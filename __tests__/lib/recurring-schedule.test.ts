import { describe, it, expect } from "vitest";
import {
  hasRecurringSchedule,
  computeNextOccurrence,
  isLiveNow,
} from "@/lib/recurring-schedule";
import type { Subject } from "@/lib/types/database";

const baseSubject: Subject = {
  id: "s1",
  offering_id: "o1",
  title: "Hadith Class",
  slug: "hadith",
  description: null,
  instructor_id: "i1",
  sort_order: 1,
  recurring_day_of_week: 1, // Monday
  recurring_start_time: "18:00:00", // 6 PM PKT = 13:00 UTC
  recurring_duration_minutes: 60,
  recurring_meeting_url: "https://zoom.us/j/123",
  recurring_schedule_label: "Mondays 6–7 PM PKT",
  quiz_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("hasRecurringSchedule()", () => {
  it("returns true when all recurring fields are set", () => {
    expect(hasRecurringSchedule(baseSubject)).toBe(true);
  });

  it("returns false when day_of_week is null", () => {
    expect(hasRecurringSchedule({ ...baseSubject, recurring_day_of_week: null })).toBe(false);
  });

  it("returns false when start_time is null", () => {
    expect(hasRecurringSchedule({ ...baseSubject, recurring_start_time: null })).toBe(false);
  });

  it("returns false when meeting_url is null", () => {
    expect(hasRecurringSchedule({ ...baseSubject, recurring_meeting_url: null })).toBe(false);
  });
});

describe("computeNextOccurrence()", () => {
  it("returns start and end Date objects", () => {
    const result = computeNextOccurrence(baseSubject);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.start).toBeInstanceOf(Date);
      expect(result.end).toBeInstanceOf(Date);
    }
  });

  it("end is duration minutes after start", () => {
    const result = computeNextOccurrence(baseSubject);
    if (result) {
      const diffMs = result.end.getTime() - result.start.getTime();
      expect(diffMs).toBe(60 * 60 * 1000); // 60 minutes
    }
  });

  it("returns null for subject with no schedule", () => {
    const noSchedule = { ...baseSubject, recurring_day_of_week: null };
    expect(computeNextOccurrence(noSchedule)).toBeNull();
  });
});

describe("isLiveNow()", () => {
  it("returns false when no recurring schedule", () => {
    const noSchedule = { ...baseSubject, recurring_day_of_week: null };
    expect(isLiveNow(noSchedule)).toBe(false);
  });

  it("returns a boolean", () => {
    expect(typeof isLiveNow(baseSubject)).toBe("boolean");
  });
});
