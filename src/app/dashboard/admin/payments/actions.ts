"use server";

/**
 * Admin Payment / Enrollment Approval Server Actions.
 *
 * The headline action is `approveEnrollmentWithCredentials` — used by both
 * the Payment Ledger and the Enrollments page Approve buttons. It:
 *
 *   1. Ensures the applicant has a Supabase auth account (creates one if
 *      it's a guest enrollment, otherwise finds the existing user).
 *   2. Generates a unique invite link (new users) or recovery link (existing
 *      users) via Supabase Admin API — no shared passwords are set or sent.
 *   3. Links the enrollment row's student_id back to the auth user (for
 *      historical guest enrollments) and backfills profile.full_name.
 *   4. Flips the enrollment to status='approved'.
 *   5. Sends the sister a branded credentials email with a one-time secure
 *      link to set her own password.
 *
 * Why service_role: we need admin.auth.admin.{listUsers,createUser,
 * generateLink} to mutate auth.users, which the user's session can't
 * do directly through RLS.
 *
 * Auth: caller must be `admin` or `treasurer` (treasurer can approve
 * payments but not modify enrollments any other way — same access scope
 * as /dashboard/admin/payments).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/db/auth";
import { logAudit } from "@/lib/db/audit";
import { sendCredentialsEmail } from "@/lib/email";


/**
 * Page through admin.auth.admin.listUsers looking for an existing user
 * whose email matches `email` (case-insensitive). Returns undefined if
 * not found. We page because Supabase caps perPage at 1000.
 */
async function findAuthUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<{ id: string; email: string } | undefined> {
  const needle = email.toLowerCase().trim();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const match = data.users.find(
      (u) => (u.email || "").toLowerCase() === needle
    );
    if (match) return { id: match.id, email: match.email || needle };
    if (data.users.length < 1000) return undefined;
    page += 1;
  }
}

interface ProvisionResult {
  success: boolean;
  error?: string;
  /** "created" → new auth user provisioned; "updated" → existing user reset. */
  mode?: "created" | "updated";
  /** True if the credentials email was successfully sent. */
  emailSent?: boolean;
}

/**
 * The shared provisioning engine. Does NOT touch enrollment.status —
 * callers are responsible for flipping the status (or not) according to
 * their own bookkeeping. Returns details the caller can surface to the
 * admin (mode, email delivery state).
 *
 * Pre-conditions: caller already verified auth.
 */
async function provisionCredentialsCore(
  admin: ReturnType<typeof createAdminClient>,
  enrollmentId: string
): Promise<ProvisionResult> {
  // Fetch the enrollment with the offering title we'll quote in the email.
  const { data: enrollment, error: fetchErr } = await admin
    .from("enrollments")
    .select(
      "id, status, student_id, applicant_email, offering_id, student_details, offerings(title)"
    )
    .eq("id", enrollmentId)
    .single();
  if (fetchErr || !enrollment) {
    return {
      success: false,
      error: fetchErr?.message || "Enrollment not found.",
    };
  }

  const offering = enrollment.offerings as unknown as { title: string } | null;
  const offeringTitle = offering?.title || "your course";

  // Recipient email: prefer the applicant_email recorded on the row,
  // fall back to the auth.users email for linked enrollments.
  let recipientEmail = (enrollment.applicant_email || "").toLowerCase().trim();
  if (!recipientEmail && enrollment.student_id) {
    const { data: authUser } = await admin.auth.admin.getUserById(
      enrollment.student_id
    );
    recipientEmail = (authUser?.user?.email || "").toLowerCase().trim();
  }
  if (!recipientEmail) {
    return {
      success: false,
      error: "Enrollment has no email address — cannot send credentials.",
    };
  }

  // Best-effort name for the email greeting + profile backfill.
  let studentName = "";
  if (enrollment.student_id) {
    const { data: prof } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", enrollment.student_id)
      .single();
    studentName = prof?.full_name || "";
  }
  if (!studentName) {
    const d = (enrollment.student_details || {}) as {
      full_name?: string;
      name?: string;
      first_name?: string;
      last_name?: string;
    };
    studentName =
      d.full_name ||
      d.name ||
      [d.first_name, d.last_name].filter(Boolean).join(" ").trim() ||
      "";
  }

  // ── Provision (or find) the auth account ──
  let authUserId = enrollment.student_id || "";
  let mode: "created" | "updated" = "updated";

  if (!authUserId) {
    const existing = await findAuthUserByEmail(admin, recipientEmail);
    if (existing) {
      authUserId = existing.id;
    } else {
      // New guest — create account without pre-setting a password.
      // A unique invite link is generated below; clicking it is the
      // student's one-time login and takes her to /reset-password.
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email: recipientEmail,
          email_confirm: true,
          user_metadata: studentName ? { full_name: studentName } : undefined,
        });
      if (createErr || !created?.user) {
        return {
          success: false,
          error: `Could not create account: ${createErr?.message || "unknown"}`,
        };
      }
      authUserId = created.user.id;
      mode = "created";
    }
  }
  // Existing users keep their current password — a unique recovery link
  // is generated below so they can set/reset it if needed.

  // ── Link the enrollment row to the auth user (guest enrollments) ──
  if (!enrollment.student_id) {
    const { error: linkErr } = await admin
      .from("enrollments")
      .update({ student_id: authUserId })
      .eq("id", enrollmentId);
    if (linkErr) console.warn("[Approve] Could not link student_id:", linkErr);
  }

  // ── Backfill profile.full_name if the row exists but is blank ──
  // handle_new_user trigger seeds a row on user creation, so by the time
  // we get here a profile should exist. Best-effort — don't fail
  // approval if this update bumps.
  if (studentName) {
    const { data: prof } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", authUserId)
      .maybeSingle();
    if (prof && !prof.full_name) {
      await admin
        .from("profiles")
        .update({ full_name: studentName })
        .eq("id", authUserId);
    }
  }

  // ── Generate a unique login link per student ──
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.nisaalhuda.org";
  const redirectTo = `${siteUrl}/auth/callback?next=/reset-password`;
  const linkOptions =
    mode === "created" && studentName
      ? { redirectTo, data: { full_name: studentName } }
      : { redirectTo };

  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: mode === "created" ? "invite" : "recovery",
      email: recipientEmail,
      options: linkOptions,
    });

  if (linkErr || !linkData?.properties?.action_link) {
    return {
      success: true,
      mode,
      emailSent: false,
      error: `Account ready, but login link failed: ${linkErr?.message || "unknown"}`,
    };
  }

  // ── Send the credentials email with the unique link ──
  const emailRes = await sendCredentialsEmail(
    recipientEmail,
    studentName,
    linkData.properties.action_link,
    mode === "created",
    offeringTitle
  );

  return {
    success: true,
    mode,
    emailSent: emailRes.ok,
    error: emailRes.ok
      ? undefined
      : `Account ready, but email failed: ${emailRes.error}`,
  };
}

/**
 * Full approval flow: provision credentials AND flip the enrollment to
 * `status='approved'`. Used by both the Payment-Ledger and Enrollments-
 * page Approve buttons.
 */
export async function approveEnrollmentWithCredentials(
  enrollmentId: string
): Promise<ProvisionResult> {
  const auth = await requireRole(["admin", "treasurer"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();

  const provision = await provisionCredentialsCore(admin, enrollmentId);
  if (!provision.success) return provision;

  // Flip enrollment to approved AFTER credentials are set, so a failure
  // during provisioning leaves the enrollment pending (admin can retry).
  const { error: statusErr } = await admin
    .from("enrollments")
    .update({
      status: "approved",
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId);
  if (statusErr) {
    return {
      success: false,
      error: `Credentials set but status update failed: ${statusErr.message}`,
    };
  }

  await logAudit({
    actorId: auth.userId,
    action: "enrollment.approved",
    entityType: "enrollment",
    entityId: enrollmentId,
    summary: "Approved an enrollment and issued login credentials",
    metadata: { enrollmentId },
  });

  return provision;
}

/**
 * Provision-only sibling of approveEnrollmentWithCredentials —
 * ensure auth account + reset password + link student_id + email
 * credentials, WITHOUT flipping enrollment.status. Used by approval
 * paths (FA full-waiver, manual enrollment) that need to do their own
 * status bookkeeping but still want every approved sister to receive
 * her login credentials.
 */
export async function provisionCredentialsForEnrollment(
  enrollmentId: string
): Promise<ProvisionResult> {
  const auth = await requireRole(["admin", "treasurer"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();
  return provisionCredentialsCore(admin, enrollmentId);
}

/**
 * Reject path mirror of approveEnrollmentWithCredentials — keeps the
 * client component free of direct DB writes (and of /api/email pings)
 * so both buttons go through one consistent service-role channel.
 */
export async function rejectEnrollment(
  enrollmentId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireRole(["admin", "treasurer"]);
  if (!auth.ok) return { success: false, error: auth.error };
  if (!reason?.trim()) {
    return { success: false, error: "Please provide a rejection reason." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("enrollments")
    .update({
      status: "rejected",
      rejection_reason: reason.trim(),
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId);
  if (error) return { success: false, error: error.message };

  await logAudit({
    actorId: auth.userId,
    action: "enrollment.rejected",
    entityType: "enrollment",
    entityId: enrollmentId,
    summary: `Rejected an enrollment — ${reason.trim()}`,
    metadata: { reason: reason.trim() },
  });

  return { success: true };
}

/**
 * Manually approve a monthly cycle for a sister WITHOUT requiring her to
 * upload a receipt. Used when a sister pays cash, JazzCash, or any other
 * offline channel — admin records the amount + note and the cycle flips
 * to `approved` immediately.
 *
 * One-time override only: this clears THIS cycle. The cron continues to
 * roll new 'owed' rows every cycle as before; admin will re-approve each
 * month she pays offline. (Contrast with `manual_approval` which marks
 * her permanently off the billing cycle.)
 *
 * Conflict rule: if a pending receipt already exists for this cycle, the
 * action refuses — admin must review/reject the receipt first to keep
 * the audit trail clean.
 *
 * Two entry shapes:
 *   - by monthlyPaymentId: when an 'owed' placeholder already exists
 *     (cron created it). We UPDATE the row in place.
 *   - by enrollmentId + cycleMonth: when no row exists yet (cycle is
 *     billable but cron hasn't run / pre-launch enrollment). We INSERT
 *     a fresh row.
 */
export async function approveMonthlyPaymentManually(args: {
  monthlyPaymentId?: string;
  enrollmentId?: string;
  cycleMonth?: string;
  amount: number;
  note: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireRole(["admin", "treasurer"]);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!Number.isFinite(args.amount) || args.amount < 0) {
    return { success: false, error: "Amount must be a non-negative number." };
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const trimmedNote = (args.note || "").trim() || null;

  // ── Path A: update an existing 'owed' (or 'rejected') placeholder ──
  if (args.monthlyPaymentId) {
    const { data: existing, error: fetchErr } = await admin
      .from("monthly_payments")
      .select("id, status")
      .eq("id", args.monthlyPaymentId)
      .single();
    if (fetchErr || !existing) {
      return { success: false, error: "Cycle row not found." };
    }
    if (existing.status === "pending") {
      return {
        success: false,
        error:
          "A receipt is pending review for this cycle. Approve or reject the receipt first.",
      };
    }
    if (existing.status === "approved") {
      return { success: false, error: "This cycle is already approved." };
    }

    const { error: updErr } = await admin
      .from("monthly_payments")
      .update({
        status: "approved",
        amount: args.amount,
        payment_method: "admin_recorded",
        receipt_url: null,
        manual_note: trimmedNote,
        reviewed_by: auth.userId,
        reviewed_at: nowIso,
        rejection_reason: null,
      })
      .eq("id", args.monthlyPaymentId);
    if (updErr) return { success: false, error: updErr.message };

    await logAudit({
      actorId: auth.userId,
      action: "monthly_payment.manual_approved",
      entityType: "monthly_payment",
      entityId: args.monthlyPaymentId,
      summary: `Recorded an offline payment of ${args.amount} for a monthly cycle`,
      metadata: { amount: args.amount, note: trimmedNote, path: "update" },
    });

    return { success: true };
  }

  // ── Path B: insert a fresh row for a cycle that doesn't have one ──
  if (!args.enrollmentId || !args.cycleMonth) {
    return {
      success: false,
      error: "Either monthlyPaymentId or (enrollmentId + cycleMonth) is required.",
    };
  }

  // Defense in depth: make sure no row already exists for this cycle.
  // (Path A handles updates; Path B is INSERT-only.)
  const { data: dupe } = await admin
    .from("monthly_payments")
    .select("id, status")
    .eq("enrollment_id", args.enrollmentId)
    .eq("cycle_month", args.cycleMonth)
    .maybeSingle();
  if (dupe) {
    if (dupe.status === "pending") {
      return {
        success: false,
        error:
          "A receipt is pending review for this cycle. Approve or reject the receipt first.",
      };
    }
    if (dupe.status === "approved") {
      return { success: false, error: "This cycle is already approved." };
    }
    // 'owed' / 'rejected' → fall through to UPDATE path for safety.
    return approveMonthlyPaymentManually({
      monthlyPaymentId: dupe.id,
      amount: args.amount,
      note: args.note,
    });
  }

  // Look up the enrollment to derive student_id, offering_id, currency.
  const { data: enrollment, error: enrErr } = await admin
    .from("enrollments")
    .select("id, student_id, offering_id, payment_currency")
    .eq("id", args.enrollmentId)
    .single();
  if (enrErr || !enrollment) {
    return { success: false, error: "Enrollment not found." };
  }
  if (!enrollment.student_id) {
    return {
      success: false,
      error:
        "Enrollment isn't linked to an auth user yet — approve the initial enrollment first.",
    };
  }

  const { error: insErr } = await admin.from("monthly_payments").insert({
    enrollment_id: enrollment.id,
    student_id: enrollment.student_id,
    offering_id: enrollment.offering_id,
    cycle_month: args.cycleMonth,
    amount: args.amount,
    currency: enrollment.payment_currency || "PKR",
    payment_method: "admin_recorded",
    receipt_url: null,
    sender_name: null,
    status: "approved",
    manual_note: trimmedNote,
    reviewed_by: auth.userId,
    reviewed_at: nowIso,
  });
  if (insErr) return { success: false, error: insErr.message };

  await logAudit({
    actorId: auth.userId,
    action: "monthly_payment.manual_approved",
    entityType: "monthly_payment",
    entityId: enrollment.id,
    summary: `Recorded an offline payment of ${args.amount} for the ${args.cycleMonth} cycle`,
    metadata: {
      amount: args.amount,
      note: trimmedNote,
      cycleMonth: args.cycleMonth,
      path: "insert",
    },
  });

  return { success: true };
}
