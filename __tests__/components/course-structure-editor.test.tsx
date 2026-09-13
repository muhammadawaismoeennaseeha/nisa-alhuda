/**
 * Course Structure editor — the admin-side editing surface.
 *
 * The behaviour worth pinning here is the destructive path, because
 * `lessons.recording_url` is the only copy of a class recording anywhere in
 * Nisa:
 *
 *   - the per-row recording flag stays a label, never a link or a button, even
 *     now that every row carries a cluster of controls next to it;
 *   - deleting a lesson that has a recording names the URL and says it's lost;
 *   - deleting a subject whose lessons carry recordings is refused outright,
 *     because `ON DELETE CASCADE` would take them silently.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CourseStructureEditor } from "@/components/course/course-structure-editor";
import type { Lesson, Subject } from "@/lib/types/database";

// The editor only builds a client inside a write handler, but the browser
// client reads NEXT_PUBLIC_* env at call time — stub it so a mis-click in a
// test can never reach a real Supabase project.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    throw new Error("no Supabase in unit tests");
  },
}));

const RECORDING = "https://drive.google.com/file/d/1AbC_dEfG-h/view";

const SUBJECTS: (Subject & { instructor?: { full_name: string | null } })[] = [
  {
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
    instructor: { full_name: "Ustadha Maryam" },
  },
  {
    id: "sub-2",
    offering_id: "off-1",
    title: "Seerah",
    slug: "seerah",
    description: null,
    instructor_id: "ins-1",
    sort_order: 1,
    recurring_meeting_url: null,
    recurring_schedule_label: null,
    recurring_day_of_week: null,
    recurring_start_time: null,
    recurring_duration_minutes: null,
    quiz_url: null,
    created_at: "2025-12-01T00:00:00Z",
    updated_at: "2025-12-01T00:00:00Z",
  },
];

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
  lesson({ id: "les-1", recording_url: RECORDING }),
  lesson({ id: "les-2", title: "Wudu in Detail", sort_order: 1 }),
  lesson({
    id: "les-3",
    title: "The Hijrah",
    subject_id: "sub-2",
    sort_order: 2,
    is_published: false,
  }),
];

function renderEditor(lessons: Lesson[] = LESSONS) {
  return render(
    <CourseStructureEditor
      offeringId="off-1"
      subjects={SUBJECTS}
      lessons={lessons}
      resourceCounts={{ "les-1": 2 }}
      instructors={[{ id: "ins-1", full_name: "Ustadha Maryam" }]}
      defaultInstructorId="ins-1"
    />
  );
}

describe("CourseStructureEditor", () => {
  it("offers admin controls for subjects and lessons in place", () => {
    renderEditor();

    expect(
      screen.getByRole("button", { name: "Add subject" })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add class" })).toHaveLength(2);

    expect(
      screen.getByRole("button", { name: "Edit Fiqh of Worship" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete Fiqh of Worship" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Wudu in Detail" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Publish The Hijrah" })
    ).toBeInTheDocument();
  });

  it("disables the reorder arrows at the ends of a list", () => {
    renderEditor();

    expect(
      screen.getByRole("button", { name: "Move Fiqh of Worship up" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Seerah down" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Fiqh of Worship down" })
    ).toBeEnabled();
  });

  it("keeps the recording flag a label, not a link or a button", () => {
    renderEditor();

    const flags = screen.getAllByText("Recording");
    expect(flags).toHaveLength(1);
    expect(flags[0].closest("button")).toBeNull();
    expect(flags[0].closest("a")).toBeNull();
    // The URL itself is never in the list's DOM.
    expect(screen.queryByText(RECORDING)).toBeNull();
  });

  it("names the recording and warns it is lost before deleting that lesson", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(
      screen.getByRole("button", { name: "Delete Tahara — Purification" })
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("This class has a recording. It will be lost.")
    ).toBeInTheDocument();
    expect(within(dialog).getByText(RECORDING)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", {
        name: "Delete class and its recording",
      })
    ).toBeInTheDocument();
  });

  it("does not mention a recording when deleting a lesson without one", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(
      screen.getByRole("button", { name: "Delete Wudu in Detail" })
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/has a recording/)).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Delete class" })
    ).toBeInTheDocument();
  });

  it("refuses to delete a subject whose lessons hold recordings", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(
      screen.getByRole("button", { name: "Delete Fiqh of Worship" })
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("This subject holds recordings")
    ).toBeInTheDocument();
    // No destructive action at all — the cascade is closed, not confirmed.
    expect(
      within(dialog).queryByRole("button", { name: "Delete subject" })
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Close" })
    ).toBeInTheDocument();
  });

  it("allows deleting a subject whose lessons have no recordings", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Delete Seerah" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Delete subject" })
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/None of them has a recording/)
    ).toBeInTheDocument();
  });

  it("locks the recording field when editing a lesson that already has one", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(
      screen.getByRole("button", { name: "Edit Tahara — Purification" })
    );

    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Recording URL");
    expect(field).toHaveValue(RECORDING);
    expect(field).toHaveAttribute("readonly");

    // Unlocking is deliberate, and says what it costs.
    await user.click(within(dialog).getByRole("button", { name: "Replace" }));
    expect(field).not.toHaveAttribute("readonly");
    expect(
      within(dialog).getByText(/overwrites the stored recording link/)
    ).toBeInTheDocument();
  });

  it("leaves the recording field open on a lesson that has none", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(
      screen.getByRole("button", { name: "Edit Wudu in Detail" })
    );

    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Recording URL");
    expect(field).toHaveValue("");
    expect(field).not.toHaveAttribute("readonly");
    expect(within(dialog).queryByRole("button", { name: "Replace" })).toBeNull();
  });

  it("shows an empty state that starts with adding a subject", () => {
    render(
      <CourseStructureEditor
        offeringId="off-1"
        subjects={[]}
        lessons={[]}
        resourceCounts={{}}
      />
    );

    expect(screen.getByText("No subjects yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add subject" })
    ).toBeInTheDocument();
  });
});
