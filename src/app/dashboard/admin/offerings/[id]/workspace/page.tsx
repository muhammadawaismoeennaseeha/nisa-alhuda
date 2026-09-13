/**
 * Admin course workspace — the Naseeha "Courses" shell over Nisa's data.
 *
 * One course page with a shared header and a five-tab strip (Overview, People,
 * Course Structure, Schedule, Details) instead of a spread of separate screens.
 * This is now the only route for managing an offering:
 * /dashboard/admin/offerings/[id]/edit and .../students are redirects into the
 * Details and People tabs.
 *
 * Every query in this file is a SELECT. Writes happen in the client components
 * it renders — the header's archive/delete, the Course Structure editor, the
 * People tab's enrol dialog and the Details tab's offering form — each through
 * the module it already used before this screen existed. In particular the
 * structure editor goes through `@/lib/course-structure`, which patches named
 * columns rather than whole rows so `lessons.recording_url` is never written
 * unless a caller asks for it explicitly.
 */
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  Enrollment,
  Lesson,
  Offering,
  StudentDetails,
  Subject,
} from "@/lib/types/database";
import { CourseWorkspace } from "./course-workspace";
import { isTabKey } from "./tabs";

type RosterRow = Enrollment & {
  student_details: (StudentDetails & { country?: string }) | null;
  student?: { full_name: string | null } | null;
};

type SubjectWithInstructor = Subject & {
  instructor?: { full_name: string | null } | null;
};

export default async function OfferingWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const { data: offering } = await supabase
    .from("offerings")
    .select("*, instructor:profiles!offerings_instructor_id_fkey(full_name)")
    .eq("id", id)
    .single<Offering & { instructor: { full_name: string | null } | null }>();

  if (!offering) notFound();

  // The viewer's role drives the Details tab's `hideFinance` flag, exactly as
  // it did on the edit page: instructors don't see price or fee type.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Subjects, lessons, the roster, the pending-request count, the instructor
  // list and the viewer's profile are independent reads — fire them together
  // rather than paying six sequential round-trips.
  const [
    subjectsRes,
    lessonsRes,
    enrollmentsRes,
    pendingRes,
    instructorsRes,
    profileRes,
    assistantsRes,
    taCandidatesRes,
  ] = await Promise.all([
    supabase
      .from("subjects")
      .select("*, instructor:profiles!subjects_instructor_id_fkey(full_name)")
      .eq("offering_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("lessons")
      .select("*")
      .eq("offering_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("enrollments")
      .select("*, student:profiles!enrollments_student_id_fkey(full_name)")
      .eq("offering_id", id)
      .eq("status", "approved")
      .order("created_at", { ascending: false }),
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("offering_id", id)
      .eq("status", "pending"),
    // `subjects.instructor_id` is NOT NULL, so the structure editor's subject
    // dialog needs the candidates up front — same query the offering edit page
    // runs for its subject rows.
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "instructor")
      .order("full_name"),
    user
      ? supabase.from("profiles").select("role").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
    // Current Teaching Assistants on this course (Module 7). Join to profiles
    // for the display name; the row itself only carries ids.
    supabase
      .from("course_assistants")
      .select(
        "assistant_id, assistant:profiles!course_assistants_assistant_id_fkey(id, full_name)"
      )
      .eq("offering_id", id),
    // Everyone who holds the `ta` role -- primary slot or the roles[] array
    // -- as candidates for the assignment picker.
    supabase
      .from("profiles")
      .select("id, full_name")
      .or("role.eq.ta,roles.cs.{ta}")
      .order("full_name"),
  ]);

  const subjects = (subjectsRes.data || []) as SubjectWithInstructor[];
  const lessons = (lessonsRes.data || []) as Lesson[];
  const roster = (enrollmentsRes.data || []) as RosterRow[];
  const instructors = (instructorsRes.data || []) as {
    id: string;
    full_name: string | null;
  }[];
  const hideFinance =
    (profileRes.data as { role?: string } | null)?.role === "instructor";
  const isAdmin =
    (profileRes.data as { role?: string } | null)?.role === "admin";

  // Teaching Assistants already on this course, and the candidates an admin
  // can still add (all TAs minus those already assigned).
  const assistants = (
    (assistantsRes.data || []) as unknown as {
      assistant: { id: string; full_name: string | null } | null;
    }[]
  )
    .map((r) => r.assistant)
    .filter((p): p is { id: string; full_name: string | null } => p !== null);
  const assignedIds = new Set(assistants.map((p) => p.id));
  const taCandidates = (
    (taCandidatesRes.data || []) as { id: string; full_name: string | null }[]
  ).filter((p) => !assignedIds.has(p.id));

  // Resource counts need the lesson ids, so this one can't join the batch
  // above. `head: true` per lesson would be N round-trips; one `in` query and
  // a tally in JS is cheaper than either.
  const resourceCounts: Record<string, number> = {};
  if (lessons.length > 0) {
    const { data: resourceRows } = await supabase
      .from("resources")
      .select("lesson_id")
      .in(
        "lesson_id",
        lessons.map((l) => l.id)
      );
    for (const row of (resourceRows || []) as { lesson_id: string }[]) {
      resourceCounts[row.lesson_id] = (resourceCounts[row.lesson_id] ?? 0) + 1;
    }
  }

  return (
    <CourseWorkspace
      offering={offering}
      instructorName={offering.instructor?.full_name ?? null}
      subjects={subjects}
      lessons={lessons}
      roster={roster}
      pendingCount={pendingRes.count ?? 0}
      resourceCounts={resourceCounts}
      instructors={instructors}
      hideFinance={hideFinance}
      isAdmin={isAdmin}
      assistants={assistants}
      taCandidates={taCandidates}
      initialTab={isTabKey(tab) ? tab : "overview"}
    />
  );
}
