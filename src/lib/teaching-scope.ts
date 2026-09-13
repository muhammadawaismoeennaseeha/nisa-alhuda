/**
 * Teaching scope — resolves which courses a member of teaching staff may act
 * on. A full instructor owns courses via `offerings.instructor_id` /
 * `subjects.instructor_id` (handled by the existing instructor_id filters). A
 * Teaching Assistant, instead, is scoped by the `course_assistants` join
 * (migration 038): they may act only on the offerings they are assigned to.
 *
 * Level 1 ships this reader; Level 2 folds it into the instructor screens so a
 * TA sees exactly their assigned courses and nothing else.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The offering IDs this user is assigned to assist (empty if none / not a TA). */
export async function fetchAssistedOfferingIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  userId: string
): Promise<string[]> {
  const { data } = await client
    .from("course_assistants")
    .select("offering_id")
    .eq("assistant_id", userId);
  return (data ?? []).map((r: { offering_id: string }) => r.offering_id);
}
