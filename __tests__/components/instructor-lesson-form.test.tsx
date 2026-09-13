/**
 * Instructor Class form — the recording lock.
 *
 * `lessons.recording_url` is the only copy of a class recording anywhere in
 * Nisa. The admin's `LessonDialog` has always opened that field LOCKED when a
 * recording exists; the Phase 5 re-skin brings the same protection to the
 * instructor's form, which is the screen an instructor actually edits classes
 * on day to day.
 *
 * Mirrors `course-structure-editor.test.tsx`'s two lock cases, and adds the one
 * that matters just as much in the other direction: a class with NO recording
 * must stay freely editable, so adding a recording is never harder than it was.
 *
 * Also pinned here: deleting a class that holds a recording names the URL in
 * the confirmation, the same way the admin structure editor does.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LessonForm } from "@/app/dashboard/instructor/subjects/[id]/lesson-form";
import { LessonList } from "@/app/dashboard/instructor/subjects/[id]/lesson-list";
import type { Lesson } from "@/lib/types/database";

// Neither component builds a client outside a write handler, but the browser
// client reads NEXT_PUBLIC_* at call time — stub it so a mis-click in a test
// can never reach a real Supabase project.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    throw new Error("no Supabase in unit tests");
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const RECORDING = "https://drive.google.com/file/d/1AbC_dEfG-h/view";

function lesson(overrides: Partial<Lesson> = {}): Lesson {
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

function renderForm(target: Lesson | null) {
  return render(
    <LessonForm
      subjectId="sub-1"
      offeringId="off-1"
      lesson={target}
      nextSortOrder={1}
      onClose={() => {}}
    />
  );
}

describe("instructor LessonForm — recording field", () => {
  it("locks the recording field when the class already has one", async () => {
    const user = userEvent.setup();
    renderForm(lesson({ recording_url: RECORDING }));

    const field = screen.getByLabelText("Recording URL");
    expect(field).toHaveValue(RECORDING);
    expect(field).toHaveAttribute("readonly");
    expect(
      screen.getByText(/left exactly as it is saved unless you choose/)
    ).toBeInTheDocument();

    // Unlocking is deliberate, and says what it costs.
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(field).not.toHaveAttribute("readonly");
    expect(
      screen.getByText(/overwrites the stored recording link/)
    ).toBeInTheDocument();
  });

  it("leaves the recording field open on a class that has none", () => {
    renderForm(lesson());

    const field = screen.getByLabelText("Recording URL");
    expect(field).toHaveValue("");
    expect(field).not.toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
  });

  it("leaves the recording field open when creating a new class", () => {
    renderForm(null);

    const field = screen.getByLabelText("Recording URL");
    expect(field).toHaveValue("");
    expect(field).not.toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
  });
});

describe("instructor LessonList — destructive path", () => {
  function renderList(lessons: Lesson[]) {
    return render(
      <LessonList
        subjectId="sub-1"
        offeringId="off-1"
        lessons={lessons}
        initialResources={[]}
      />
    );
  }

  it("names the recording and warns it is lost before deleting that class", async () => {
    const user = userEvent.setup();
    renderList([lesson({ recording_url: RECORDING })]);

    // The controls live inside the expanded body.
    await user.click(screen.getByRole("button", { expanded: false }));
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

  it("does not mention a recording when deleting a class without one", async () => {
    const user = userEvent.setup();
    renderList([lesson()]);

    await user.click(screen.getByRole("button", { expanded: false }));
    await user.click(
      screen.getByRole("button", { name: "Delete Tahara — Purification" })
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/has a recording/)).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Delete class" })
    ).toBeInTheDocument();
  });

  it("still offers the watch affordance for a non-YouTube recording", async () => {
    const user = userEvent.setup();
    renderList([lesson({ recording_url: RECORDING })]);

    await user.click(screen.getByRole("button", { expanded: false }));
    const watch = screen.getByRole("link", { name: /Watch recording/ });
    expect(watch).toHaveAttribute("href", RECORDING);
  });
});
