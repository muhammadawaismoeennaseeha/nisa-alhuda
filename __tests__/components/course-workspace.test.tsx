/**
 * Admin course workspace — tab rendering.
 *
 * Overview server-renders, but People, Course Structure and Schedule are behind
 * client tab state, so nothing but a click proves they render. This covers all
 * four, and pins the one guarantee that matters most: the structure view
 * surfaces a lesson's recording as a read-only indicator and offers no control
 * that could clear it.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CourseWorkspace } from "@/app/dashboard/admin/offerings/[id]/workspace/course-workspace";
import type { Lesson, Offering, Subject } from "@/lib/types/database";
import type { RosterEnrollment } from "@/components/course/course-roster";

const OFFERING = {
  id: "off-1",
  title: "Sisterhood Islamic Studies",
  slug: "sisterhood-islamic-studies",
  description: "Full description",
  short_description: "A six-month program.",
  type: "program",
  price: 5000,
  price_inr: null,
  price_usd: null,
  thumbnail_url: null,
  status: "published",
  instructor_id: "ins-1",
  schedule_start: "2026-01-05",
  schedule_end: "2026-06-30",
  fee_type: "monthly",
  mode: "online",
  live_class_link: null,
  is_featured: false,
  is_new: false,
  is_ongoing: false,
  whatsapp_link: null,
  admission_closed: false,
  created_at: "2025-12-01T00:00:00Z",
  updated_at: "2025-12-01T00:00:00Z",
} satisfies Offering;

const SUBJECT = {
  id: "sub-1",
  offering_id: "off-1",
  title: "Fiqh of Worship",
  slug: "fiqh-of-worship",
  description: null,
  instructor_id: "ins-1",
  sort_order: 0,
  recurring_meeting_url: "https://zoom.us/j/123",
  recurring_schedule_label: null,
  recurring_day_of_week: 1,
  recurring_start_time: "18:00:00",
  recurring_duration_minutes: 60,
  quiz_url: null,
  created_at: "2025-12-01T00:00:00Z",
  updated_at: "2025-12-01T00:00:00Z",
} satisfies Subject;

function lesson(overrides: Partial<Lesson>): Lesson {
  return {
    id: "les-1",
    offering_id: "off-1",
    subject_id: "sub-1",
    title: "Tahara — Purification",
    description: null,
    scheduled_at: "2026-01-12T13:00:00Z",
    live_class_link: null,
    recording_url: null,
    sort_order: 0,
    is_published: true,
    created_at: "2025-12-01T00:00:00Z",
    updated_at: "2025-12-01T00:00:00Z",
    ...overrides,
  };
}

const LESSONS: Lesson[] = [
  lesson({ id: "les-1", recording_url: "https://youtu.be/abc123" }),
  lesson({ id: "les-2", title: "Wudu in Detail", sort_order: 1 }),
  lesson({
    id: "les-3",
    title: "Orphan lesson",
    subject_id: null,
    sort_order: 2,
    is_published: false,
  }),
];

const ROSTER: RosterEnrollment[] = [
  {
    id: "enr-1",
    student_id: "stu-1",
    offering_id: "off-1",
    applicant_email: "aisha@example.com",
    status: "approved",
    payment_receipt_url: null,
    payment_amount: 5000,
    payment_method: "bank",
    payment_currency: "PKR",
    student_details: {
      first_name: "Aisha",
      last_name: "Fatima",
      phone: "0300-1234567",
      city: "Lahore",
      country: "Pakistan",
      age: "22",
      education_level: "Undergraduate",
      referral_source: "Instagram",
      message: "",
    },
    rejection_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    fa_requested: false,
    fa_reason: null,
    fa_income_range: null,
    fa_offered_amount: null,
    fa_approved_amount: null,
    fa_decision_note: null,
    fa_reviewed_at: null,
    created_at: "2025-12-10T00:00:00Z",
    updated_at: "2025-12-10T00:00:00Z",
  },
];

function renderWorkspace() {
  return render(
    <CourseWorkspace
      offering={OFFERING}
      instructorName="Ustadha Maryam"
      subjects={[{ ...SUBJECT, instructor: { full_name: "Ustadha Maryam" } }]}
      lessons={LESSONS}
      roster={ROSTER}
    />
  );
}

/** The desktop strip and the phone picker both render; target the strip. */
function tab(name: string) {
  return screen.getByRole("tab", { name });
}

describe("CourseWorkspace", () => {
  it("opens on Overview with the course header and metric counts", () => {
    renderWorkspace();

    expect(
      screen.getByRole("heading", { name: "Sisterhood Islamic Studies" })
    ).toBeInTheDocument();
    expect(screen.getByText("sisterhood-islamic-studies")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();

    expect(screen.getByText("Enrolled students")).toBeInTheDocument();
    // Three lessons, of which the unassigned one is still a draft.
    expect(screen.getByText("Lessons · 2 published")).toBeInTheDocument();
    // One of the three lessons carries a recording_url.
    expect(screen.getByText("Lessons with a recording")).toBeInTheDocument();
  });

  it("moves to a tab from an Overview nav card", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: /Course Structure/ }));

    expect(tab("Course Structure")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Fiqh of Worship")).toBeInTheDocument();
  });

  it("shows the roster on People", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(tab("People"));

    // The roster renders a desktop table and mobile cards; jsdom has no
    // viewport, so both are in the tree and every field appears twice.
    expect(screen.getAllByText("Aisha Fatima")).toHaveLength(2);
    expect(screen.getAllByText("aisha@example.com")).toHaveLength(2);
    expect(screen.getAllByText("Lahore, Pakistan")).toHaveLength(2);
  });

  it("lists lessons under their subject and flags recordings read-only", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(tab("Course Structure"));

    expect(screen.getByText("Tahara — Purification")).toBeInTheDocument();
    expect(screen.getByText("Wudu in Detail")).toBeInTheDocument();
    // Exactly one lesson has a recording, and it is a label — not a control.
    const flags = screen.getAllByText("Recording");
    expect(flags).toHaveLength(1);
    expect(flags[0].closest("button")).toBeNull();
    expect(flags[0].closest("a")).toBeNull();
  });

  it("surfaces lessons with no subject rather than dropping them", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(tab("Course Structure"));

    expect(screen.getByText("Unassigned lessons")).toBeInTheDocument();
    expect(screen.getByText("Orphan lesson")).toBeInTheDocument();
  });

  it("shows the weekly slot and dated lessons on Schedule", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(tab("Schedule"));

    expect(screen.getByText("Weekly classes")).toBeInTheDocument();
    expect(screen.getByText("Mondays 6:00 PM PKT")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 lessons have a date.")).toBeInTheDocument();
  });
});
