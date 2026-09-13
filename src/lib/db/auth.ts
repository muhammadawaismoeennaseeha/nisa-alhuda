/**
 * Centralised auth helpers for Server Actions.
 *
 * Before this file, every actions.ts file had its own copy of the same
 * "get user → check profile role → return ok/error" pattern — five
 * implementations across five files, each with slightly different field
 * names. Any change (e.g. adding a suspension check) had to be applied
 * in five places, and often wasn't.
 *
 * Now there's one place. Change it once, it applies everywhere.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types/database";

export type AuthOk = { ok: true; userId: string; email: string | undefined };
export type AuthFail = { ok: false; error: string };
export type AuthResult = AuthOk | AuthFail;

export type RoleAuthOk = { ok: true; userId: string; role: UserRole };
export type RoleAuthResult = RoleAuthOk | AuthFail;

/**
 * Verify the caller is authenticated (any role).
 * Returns userId + email so ownership checks can use the email without
 * a second DB round-trip.
 */
export async function requireAuth(): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  return { ok: true, userId: user.id, email: user.email };
}

/**
 * Verify the caller is authenticated AND holds one of the `allowed` roles.
 * Checks the primary `role` column — enough for all current RLS policies.
 *
 * Usage:
 *   const auth = await requireRole(["admin", "treasurer"]);
 *   if (!auth.ok) return { success: false, error: auth.error };
 *   // auth.userId, auth.role are now available
 */
export async function requireRole(
  allowed: UserRole[]
): Promise<RoleAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !allowed.includes(profile.role as UserRole)) {
    return { ok: false, error: "Not authorized." };
  }

  return { ok: true, userId: user.id, role: profile.role as UserRole };
}


/**
 * Course-scope gate for teaching writes. Admins and full instructors are
 * GLOBAL — they may act on any course, exactly as before (migration 028's
 * shared-portal model). A Teaching Assistant is scoped: they may act only on
 * offerings they are assigned to via `course_assistants` (migration 038).
 *
 * Returns `null` when the caller is authorized, or an AuthFail to return
 * straight to the client when a TA reaches for a course they don't assist.
 * `offeringId` may be null/undefined (e.g. the parent entity wasn't found);
 * that is never authorized for a TA.
 *
 * Instructor/admin behaviour is untouched: they short-circuit to `null`
 * without a database round-trip.
 */
export async function assertAssistsIfTA(
  auth: RoleAuthOk,
  offeringId: string | null | undefined
): Promise<AuthFail | null> {
  if (auth.role !== "ta") return null;
  if (!offeringId) {
    return { ok: false, error: "You can only manage courses you're assigned to." };
  }
  const admin = createAdminClient();
  const { data } = await admin
    .from("course_assistants")
    .select("id")
    .eq("offering_id", offeringId)
    .eq("assistant_id", auth.userId)
    .maybeSingle();
  if (!data) {
    return { ok: false, error: "You can only manage courses you're assigned to." };
  }
  return null;
}
