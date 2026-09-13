"use server";

/**
 * Assign / unassign Teaching Assistants on one offering.
 *
 * This is the admin side of Module 7: a TA is a scoped instructor who can act
 * ONLY on the courses listed for them in `course_assistants`. Level 2 wired the
 * scope (RLS via `assists_offering()` for reads, `assertAssistsIfTA` in the
 * teaching actions for writes); this action is how those rows come to exist.
 *
 * Design rules:
 *   - ADMIN ONLY. Assigning course staff is an administrative act; instructors
 *     and TAs cannot grant scope to anyone (including themselves).
 *   - Writes go through the service-role admin client and are audited, exactly
 *     like `updateUserRoles`.
 *   - This module NEVER touches course content — no subject, lesson, resource
 *     or `recording_url` is read or written here. Removing a TA only deletes a
 *     `course_assistants` row; the course and its recordings are untouched.
 *   - The person being assigned must actually hold the `ta` role. We don't
 *     silently grant it — an admin sets the role on the Users page first, then
 *     picks them here. This keeps "who is a TA" answerable from one place.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/db/auth";
import { logAudit } from "@/lib/db/audit";

interface TAResult {
  success: boolean;
  error?: string;
}

export async function assignTA(
  offeringId: string,
  assistantId: string
): Promise<TAResult> {
  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!offeringId || !assistantId) {
    return { success: false, error: "Missing course or person." };
  }

  const admin = createAdminClient();

  // The offering has to exist, and we want its title for the audit line.
  const { data: offering } = await admin
    .from("offerings")
    .select("id, title")
    .eq("id", offeringId)
    .maybeSingle();
  if (!offering) return { success: false, error: "Course not found." };

  // The candidate must hold the `ta` role (primary slot or the roles[] array).
  const { data: person } = await admin
    .from("profiles")
    .select("id, full_name, role, roles")
    .eq("id", assistantId)
    .maybeSingle();
  if (!person) return { success: false, error: "Person not found." };
  const holdsTA =
    person.role === "ta" ||
    (Array.isArray(person.roles) && person.roles.includes("ta"));
  if (!holdsTA) {
    return {
      success: false,
      error:
        "That person isn't a Teaching Assistant yet — set their role on the Users page first.",
    };
  }

  // Idempotent: the UNIQUE(offering_id, assistant_id) index would reject a
  // duplicate, but a friendly message beats a raw constraint error.
  const { data: existing } = await admin
    .from("course_assistants")
    .select("id")
    .eq("offering_id", offeringId)
    .eq("assistant_id", assistantId)
    .maybeSingle();
  if (existing) {
    return {
      success: false,
      error: `${person.full_name || "That person"} already assists this course.`,
    };
  }

  const { error: insErr } = await admin.from("course_assistants").insert({
    offering_id: offeringId,
    assistant_id: assistantId,
    assigned_by: auth.userId,
  });
  if (insErr) {
    console.error("[assignTA] insert error:", insErr);
    return { success: false, error: insErr.message };
  }

  await logAudit({
    actorId: auth.userId,
    action: "course.ta_assigned",
    entityType: "offering",
    entityId: offeringId,
    summary: `Assigned ${person.full_name || assistantId} as a Teaching Assistant on "${offering.title}"`,
    metadata: { offeringId, assistantId },
  });

  return { success: true };
}

export async function removeTA(
  offeringId: string,
  assistantId: string
): Promise<TAResult> {
  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!offeringId || !assistantId) {
    return { success: false, error: "Missing course or person." };
  }

  const admin = createAdminClient();

  // Snapshot the name for the audit line before the row goes.
  const { data: person } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", assistantId)
    .maybeSingle();
  const { data: offering } = await admin
    .from("offerings")
    .select("title")
    .eq("id", offeringId)
    .maybeSingle();

  // Deletes ONLY the assignment row. course_assistants has no cascade into
  // course content — subjects, lessons and recordings are never touched here.
  const { error: delErr } = await admin
    .from("course_assistants")
    .delete()
    .eq("offering_id", offeringId)
    .eq("assistant_id", assistantId);
  if (delErr) {
    console.error("[removeTA] delete error:", delErr);
    return { success: false, error: delErr.message };
  }

  await logAudit({
    actorId: auth.userId,
    action: "course.ta_removed",
    entityType: "offering",
    entityId: offeringId,
    summary: `Removed ${person?.full_name || assistantId} as a Teaching Assistant from "${offering?.title || offeringId}"`,
    metadata: { offeringId, assistantId },
  });

  return { success: true };
}
