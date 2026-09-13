"use server";

/**
 * Transcript issuance (Module 5) — server actions.
 *
 * Same discipline as the gradebook: every write goes through the service-role
 * client AFTER requireRole gates the caller, and every change is audited.
 *
 * RECORDS SAFETY. Issuing a transcript FREEZES a copy of the student's record
 * — it never edits a grade. A student can never reach these actions
 * (requireRole staff), and transcripts have NO update policy at all, so an
 * issued record is immutable. Voiding (deleting) a mistaken record is
 * admin-only, both here and in RLS.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/db/auth";
import { logAudit } from "@/lib/db/audit";
import { fetchTranscriptForStudent } from "@/lib/transcripts";

type Result<T = void> = { success: boolean; error?: string; data?: T };

const STAFF = ["admin", "instructor"] as const;

const staffPath = (studentId: string) =>
  `/dashboard/instructor/students/${studentId}/transcript`;

/**
 * Issue an official transcript: snapshot the student's CURRENT live record
 * into an immutable, serial-numbered row. Returns the assigned serial.
 */
export async function issueTranscript(
  studentId: string,
  notes?: string
): Promise<Result<{ serial: string }>> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  const data = await fetchTranscriptForStudent(admin, studentId);

  if (data.gradedSubjectCount === 0) {
    return {
      success: false,
      error: "Nothing has been graded yet — there is nothing to issue.",
    };
  }

  const cleanNotes = notes?.trim() || null;
  const { data: inserted, error } = await admin
    .from("transcripts")
    .insert({
      student_id: studentId,
      student_name: data.studentName,
      cumulative_pct: data.cumulativePct,
      cumulative_letter: data.cumulativeLetter,
      snapshot: data,
      notes: cleanNotes,
      issued_by: auth.userId,
    })
    .select("id, serial, issued_at")
    .single();

  if (error || !inserted) {
    return { success: false, error: error?.message ?? "Could not issue transcript." };
  }

  await logAudit({
    actorId: auth.userId,
    action: "transcript.issued",
    entityType: "transcript",
    entityId: inserted.id,
    summary: `Issued transcript ${inserted.serial} for ${data.studentName} (${
      data.cumulativePct ?? "—"
    }% · ${data.cumulativeLetter ?? "—"}, ${data.gradedSubjectCount} graded subjects)`,
    metadata: {
      studentId,
      serial: inserted.serial,
      cumulativePct: data.cumulativePct,
      cumulativeLetter: data.cumulativeLetter,
      gradedSubjectCount: data.gradedSubjectCount,
    },
  });

  revalidatePath(staffPath(studentId));
  revalidatePath("/dashboard/student/transcript");
  return { success: true, data: { serial: inserted.serial } };
}

/**
 * Void an issued transcript. Admin-only (mirrored in RLS). This deletes the
 * record — an issued transcript is never edited, only revoked.
 */
export async function voidTranscript(
  transcriptId: string,
  studentId: string
): Promise<Result> {
  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  // Read the serial first so the audit line names what was voided.
  const { data: existing } = await admin
    .from("transcripts")
    .select("serial, student_name")
    .eq("id", transcriptId)
    .single();

  const { error } = await admin.from("transcripts").delete().eq("id", transcriptId);
  if (error) return { success: false, error: error.message };

  await logAudit({
    actorId: auth.userId,
    action: "transcript.voided",
    entityType: "transcript",
    entityId: transcriptId,
    summary: `Voided transcript ${existing?.serial ?? transcriptId} for ${
      existing?.student_name ?? "student"
    }`,
    metadata: { studentId, serial: existing?.serial ?? null },
  });

  revalidatePath(staffPath(studentId));
  revalidatePath("/dashboard/student/transcript");
  return { success: true };
}
