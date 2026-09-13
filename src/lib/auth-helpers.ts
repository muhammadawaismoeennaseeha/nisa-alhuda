/**
 * Auth helpers — small utilities used across the dashboard to determine
 * who's looking at a page and what they should be allowed to see.
 *
 * The instructor screens (`/dashboard/instructor/*`) are now shared between
 * instructors (scoped to their own subjects) and admins (unrestricted view
 * of every instructor's subjects). RLS already permits admins on every
 * relevant table; this helper just toggles the application-layer
 * `instructor_id` filter so admins don't get accidentally narrowed.
 */
import { createClient } from "@/lib/supabase/server";
import { fetchAssistedOfferingIds } from "@/lib/teaching-scope";
import type { UserRole } from "@/lib/types/database";

export interface DashboardViewer {
  userId: string;
  fullName: string;
  role: UserRole;
  isAdmin: boolean;
  /**
   * The instructor_id to filter dashboard queries by. `null` means
   * "don't filter" — used for admins viewing all instructors' data.
   */
  instructorScope: string | null;
  /**
   * Offerings this viewer additionally assists as a Teaching Assistant
   * (migration 038). Empty for admins and for instructors with no TA
   * assignments. Combined with `instructorScope` by `applyTeachingScope`
   * so a TA sees exactly their assigned courses.
   */
  assistedOfferingIds: string[];
}

/**
 * Resolves the current logged-in user + the scope they should see in
 * instructor-style screens. Returns null if no user is logged in (caller
 * should redirect to /login or render nothing).
 */
export async function getDashboardViewer(): Promise<DashboardViewer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single<{ full_name: string; role: UserRole }>();

  const role = profile?.role ?? "student";
  const isAdmin = role === "admin";

  // A TA (or an instructor who also assists a course) is widened to the
  // courses they help with. Admins see everything, so we skip the lookup.
  const assistedOfferingIds = isAdmin
    ? []
    : await fetchAssistedOfferingIds(supabase, user.id);

  return {
    userId: user.id,
    fullName: profile?.full_name ?? "",
    role,
    isAdmin,
    // Admins see every instructor's data; instructors only their own.
    instructorScope: isAdmin ? null : user.id,
    assistedOfferingIds,
  };
}


/**
 * A minimal view of the Supabase query builder — just the two methods we
 * chain here. Keeps `applyTeachingScope` decoupled from the full generic
 * PostgrestFilterBuilder types while staying type-checked at call sites.
 */
interface ScopableSubjectsQuery {
  eq(column: string, value: string): ScopableSubjectsQuery;
  or(filter: string): ScopableSubjectsQuery;
}

/**
 * Narrow a `subjects` query to what this viewer may see:
 *   • admin        → no filter (every instructor's subjects)
 *   • instructor   → subjects they own (instructor_id = them)
 *   • TA           → subjects on the offerings they assist
 *   • instructor who also assists → their own OR assisted
 *
 * This is the single place the "courses I can teach" rule lives, so the
 * instructor screens stay identical and only the scope changes.
 */
export function applyTeachingScope<T>(query: T, viewer: DashboardViewer): T {
  // The Supabase builder type is huge and recursive, so we keep the public
  // signature generic-but-unconstrained (T in, T out) and treat the query
  // through a tiny structural view internally.
  const q = query as unknown as ScopableSubjectsQuery;
  // Admins are unscoped.
  if (viewer.instructorScope === null) return query;
  // No TA assignments → the original single-owner filter, unchanged.
  if (viewer.assistedOfferingIds.length === 0) {
    return q.eq("instructor_id", viewer.userId) as unknown as T;
  }
  // Own subjects OR any subject on an assisted offering.
  const assisted = viewer.assistedOfferingIds.join(",");
  return q.or(
    `instructor_id.eq.${viewer.userId},offering_id.in.(${assisted})`
  ) as unknown as T;
}
