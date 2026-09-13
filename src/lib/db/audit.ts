/**
 * Audit trail helper.
 *
 * One call = one row in `audit_log` (migration 033). Every sensitive admin
 * mutation (role changes, payment approvals, enrollment decisions, and the
 * modules to come) records who did what, so there is a single answerable
 * "who changed this?" trail instead of guessing from timestamps.
 *
 * Design rules:
 *   - ALWAYS writes through the service-role admin client, so the insert
 *     lands regardless of the caller's RLS scope. Reads stay admin-only.
 *   - NEVER throws. Auditing must not be able to break the action it
 *     records — a failed log is logged to the server console and swallowed.
 *   - actor_email / actor_name are stored as snapshots so the trail stays
 *     legible even after an account is deleted.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface AuditEntry {
  /** The acting user's id (from requireRole().userId). */
  actorId?: string | null;
  /** Machine-stable action key, e.g. "user.roles_updated". */
  action: string;
  /** Entity kind, e.g. "profile", "monthly_payment", "enrollment". */
  entityType: string;
  /** Id of the affected row, when there is one. */
  entityId?: string | null;
  /** Human sentence shown in the audit UI. */
  summary: string;
  /** Optional structured detail (before/after values, amounts, reasons). */
  metadata?: Record<string, unknown>;
}

/**
 * Record one audited action. Safe to `await` inline after a successful
 * mutation; it will never throw and never block the caller's result.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient();

    // Freeze a readable snapshot of who acted. Best-effort: if the lookups
    // fail we still write the row with whatever we have.
    let actorEmail: string | null = null;
    let actorName: string | null = null;
    if (entry.actorId) {
      const { data: prof } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", entry.actorId)
        .single();
      actorName = prof?.full_name ?? null;

      const { data: authUser } = await admin.auth.admin.getUserById(
        entry.actorId
      );
      actorEmail = authUser?.user?.email ?? null;
    }

    const { error } = await admin.from("audit_log").insert({
      actor_id: entry.actorId ?? null,
      actor_email: actorEmail,
      actor_name: actorName,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      summary: entry.summary,
      metadata: entry.metadata ?? {},
    });
    if (error) {
      console.error("[logAudit] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[logAudit] unexpected failure:", err);
  }
}
