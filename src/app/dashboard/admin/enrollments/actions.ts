"use server";

/**
 * Admin Enrollment Server Actions.
 * Uses service_role to handle manual enrollment (needs auth.users email lookup).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/db/auth";
import { logAudit } from "@/lib/db/audit";
import {
  sendEnrollmentApprovedEmail,
  sendFaApprovedEmail,
  sendFaRejectedEmail,
} from "@/lib/email";
import { provisionCredentialsForEnrollment } from "../payments/actions";

export async function manualEnroll(
  studentId: string,
  offeringId: string,
  price: number
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();

  // Get student's email from auth.users
  const { data: authUser, error: authError } =
    await admin.auth.admin.getUserById(studentId);
  if (authError || !authUser?.user?.email) {
    return { success: false, error: "Could not find student email." };
  }

  // Insert enrollment with applicant_email
  const { error } = await admin.from("enrollments").insert({
    student_id: studentId,
    offering_id: offeringId,
    applicant_email: authUser.user.email.toLowerCase(),
    status: "approved",
    payment_receipt_url: null,
    payment_amount: price,
    payment_method: "manual",
    reviewed_by: auth.userId,
    reviewed_at: new Date().toISOString(),
  });

  if (error) {
    console.error("Manual enrollment error:", error);
    return { success: false, error: error.message };
  }

  // Fire-and-forget email for manual enrollment (always approved)
  const { data: studentProfile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", studentId)
    .single();
  const { data: offering } = await admin
    .from("offerings")
    .select("title")
    .eq("id", offeringId)
    .single();
  if (offering) {
    sendEnrollmentApprovedEmail(
      authUser.user.email,
      studentProfile?.full_name || "",
      offering.title,
      offeringId
    ).catch(() => {});
  }

  await logAudit({
    actorId: auth.userId,
    action: "enrollment.manual_created",
    entityType: "enrollment",
    entityId: offeringId,
    summary: `Manually enrolled a student (fee ${price})`,
    metadata: { studentId, offeringId, price },
  });

  return { success: true };
}

// ─── Financial Assistance: Approve ───
// If approvedAmount is 0, the enrollment is immediately approved (full waiver).
// Otherwise, enrollment stays in "pending" with new reduced amount — student
// must upload a receipt for the reduced amount.
export async function approveFinancialAssistance(
  enrollmentId: string,
  approvedAmount: number,
  decisionNote?: string | null
): Promise<{ success: boolean; error?: string }> {
  if (approvedAmount < 0 || !Number.isFinite(approvedAmount)) {
    return { success: false, error: "Invalid amount." };
  }

  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();

  // If full waiver (0), approve the enrollment outright.
  // Otherwise, reduce payment_amount to the approved amount and keep as pending
  // — student still needs to upload receipt for the reduced fee.
  const updatePayload: Record<string, unknown> = {
    fa_approved_amount: approvedAmount,
    fa_decision_note: decisionNote?.trim() || null,
    fa_reviewed_at: new Date().toISOString(),
    payment_amount: approvedAmount,
  };

  if (approvedAmount === 0) {
    updatePayload.status = "approved";
    updatePayload.reviewed_by = auth.userId;
    updatePayload.reviewed_at = new Date().toISOString();
    updatePayload.payment_method = "waiver";
  }

  const { error } = await admin
    .from("enrollments")
    .update(updatePayload)
    .eq("id", enrollmentId);

  if (error) {
    console.error("FA approval error:", error);
    return { success: false, error: error.message };
  }

  // Fire-and-forget FA approval email
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("applicant_email, student_id, offering_id, payment_currency, offerings(title)")
    .eq("id", enrollmentId)
    .single();
  if (enrollment) {
    let email = enrollment.applicant_email;
    let studentName = "";
    if (enrollment.student_id) {
      const { data: prof } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", enrollment.student_id)
        .single();
      studentName = prof?.full_name || "";
      const { data: authUser } = await admin.auth.admin.getUserById(
        enrollment.student_id
      );
      if (authUser?.user?.email) email = authUser.user.email;
    }
    const offeringTitle = (enrollment.offerings as unknown as { title: string })
      ?.title || "";
    if (email) {
      sendFaApprovedEmail(
        email,
        studentName,
        offeringTitle,
        approvedAmount,
        approvedAmount === 0,
        (enrollment.payment_currency || "PKR") as "PKR" | "INR" | "USD"
      ).catch(() => {});
    }
  }

  // Full waiver === instant approval, so the sister should also receive
  // her login credentials (matching the Payment-Ledger Approve flow).
  // Partial-waiver approvals leave the row pending — credentials are
  // provisioned later when the reduced-fee receipt is approved.
  if (approvedAmount === 0) {
    provisionCredentialsForEnrollment(enrollmentId).catch((err) => {
      console.error("[FA Approve] provisionCredentials failed:", err);
    });
  }

  await logAudit({
    actorId: auth.userId,
    action: "enrollment.fa_approved",
    entityType: "enrollment",
    entityId: enrollmentId,
    summary:
      approvedAmount === 0
        ? "Approved financial assistance — full fee waiver"
        : `Approved financial assistance — reduced fee to ${approvedAmount}`,
    metadata: { approvedAmount, fullWaiver: approvedAmount === 0 },
  });

  return { success: true };
}

// ─── Financial Assistance: Reject ───
export async function rejectFinancialAssistance(
  enrollmentId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  if (!reason?.trim()) {
    return { success: false, error: "Please provide a reason." };
  }

  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();

  const { error } = await admin
    .from("enrollments")
    .update({
      status: "rejected",
      rejection_reason: reason.trim(),
      fa_decision_note: reason.trim(),
      fa_reviewed_at: new Date().toISOString(),
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId);

  if (error) {
    console.error("FA rejection error:", error);
    return { success: false, error: error.message };
  }

  // Fire-and-forget FA rejection email
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("applicant_email, student_id, offering_id, offerings(title)")
    .eq("id", enrollmentId)
    .single();
  if (enrollment) {
    let email = enrollment.applicant_email;
    let studentName = "";
    if (enrollment.student_id) {
      const { data: prof } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", enrollment.student_id)
        .single();
      studentName = prof?.full_name || "";
      const { data: authUser } = await admin.auth.admin.getUserById(
        enrollment.student_id
      );
      if (authUser?.user?.email) email = authUser.user.email;
    }
    const offeringTitle = (enrollment.offerings as unknown as { title: string })
      ?.title || "";
    if (email) {
      sendFaRejectedEmail(email, studentName, offeringTitle, reason).catch(
        () => {}
      );
    }
  }

  await logAudit({
    actorId: auth.userId,
    action: "enrollment.fa_rejected",
    entityType: "enrollment",
    entityId: enrollmentId,
    summary: `Rejected financial assistance — ${reason.trim()}`,
    metadata: { reason: reason.trim() },
  });

  return { success: true };
}

export async function removeEnrollment(
  studentId: string,
  offeringId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireRole(["admin", "instructor"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("enrollments")
    .delete()
    .eq("student_id", studentId)
    .eq("offering_id", offeringId);

  if (error) {
    console.error("Remove enrollment error:", error);
    return { success: false, error: error.message };
  }

  await logAudit({
    actorId: auth.userId,
    action: "enrollment.removed",
    entityType: "enrollment",
    entityId: offeringId,
    summary: "Removed a student from a course",
    metadata: { studentId, offeringId },
  });

  return { success: true };
}

// ─── Delete enrollment by id (handles guest + logged-in) ───
// Cleans the receipt file from storage too so we don't leak private uploads.
export async function deleteEnrollment(
  enrollmentId: string
): Promise<{ success: boolean; error?: string }> {
  // Removing a stray enrollment is a roster-management action (not a
  // financial decision) — instructors can do this alongside admins.
  const auth = await requireRole(["admin", "instructor"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();

  // Fetch the enrollment to find the receipt path (if any).
  const { data: enrollment, error: fetchError } = await admin
    .from("enrollments")
    .select("payment_receipt_url")
    .eq("id", enrollmentId)
    .single();

  if (fetchError) {
    console.error("Delete enrollment fetch error:", fetchError);
    return { success: false, error: "Enrollment not found." };
  }

  // Delete the enrollment row first — if storage cleanup later fails,
  // the user's intent (removing the record) is still honoured.
  const { error: deleteError } = await admin
    .from("enrollments")
    .delete()
    .eq("id", enrollmentId);

  if (deleteError) {
    console.error("Delete enrollment error:", deleteError);
    return { success: false, error: deleteError.message };
  }

  // Best-effort receipt cleanup; log (but don't fail) on error.
  if (enrollment?.payment_receipt_url) {
    const { error: storageError } = await admin.storage
      .from("payment-receipts")
      .remove([enrollment.payment_receipt_url]);
    if (storageError) {
      console.warn("Receipt storage cleanup failed:", storageError);
    }
  }

  await logAudit({
    actorId: auth.userId,
    action: "enrollment.deleted",
    entityType: "enrollment",
    entityId: enrollmentId,
    summary: "Deleted an enrollment record",
    metadata: { enrollmentId },
  });

  return { success: true };
}
