/**
 * Seed the account the Playwright specs log in as.
 *
 * Every spec in tests/e2e/ hard-codes one set of credentials. That account
 * exists in the hosted project, so against a fresh local database every test
 * sat on `page.waitForURL(/\/dashboard/)` until its 60s timeout — the suite
 * did not fail fast, it failed slowly, 127 times.
 *
 * The specs also state what that account is: feature2 and feature4 say
 * "(admin) — can see all pages" and assert admin-only navigation. Neither
 * /dashboard/student nor the learning hub is gated on role — both are gated on
 * an approved enrollment — so the account is an admin that is also enrolled,
 * which is how the admin-nav specs and the student-progress specs coexist.
 *
 * The ring and billing specs additionally need that enrollment to be in a
 * monthly-fee offering that actually has lessons: no lessons means no ring to
 * assert on, and the billing card only renders for fee_type "monthly".
 *
 * Usage: npx tsx scripts/seed-e2e-user.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing environment variables. Run: npm run env:local");
  process.exit(1);
}

if (!/127\.0\.0\.1|localhost/.test(supabaseUrl)) {
  console.error(
    `Refusing to run against a non-local backend (${supabaseUrl}).\n` +
      "This script writes a known-password test account — local stack only."
  );
  process.exit(1);
}

// Must stay in step with tests/e2e/*.spec.ts.
const EMAIL = "engineer.awaismoeen@gmail.com";
const PASSWORD = "awais123#";
const FULL_NAME = "Awais Moeen";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("Seeding the Playwright account...\n");

  let userId: string | undefined;

  const { data: created, error: createError } =
    await supabase.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: FULL_NAME },
    });

  if (created?.user) {
    userId = created.user.id;
    console.log(`Created user: ${userId}`);
  } else if (createError?.message.includes("already been registered")) {
    const { data: list } = await supabase.auth.admin.listUsers();
    userId = list?.users.find((u) => u.email === EMAIL)?.id;
    console.log(`User already present: ${userId}`);
    if (userId) {
      await supabase.auth.admin.updateUserById(userId, { password: PASSWORD });
    }
  } else {
    console.error("Error creating user:", createError?.message);
    process.exit(1);
  }

  if (!userId) {
    console.error("Could not resolve the user id.");
    process.exit(1);
  }

  await supabase
    .from("profiles")
    .update({ role: "admin", full_name: FULL_NAME })
    .eq("id", userId);

  const { data: monthly } = await supabase
    .from("offerings")
    .select("id, title, price")
    .eq("fee_type", "monthly")
    .eq("status", "published")
    .limit(1)
    .maybeSingle();

  let target = monthly;

  if (!target) {
    const { data: any_published } = await supabase
      .from("offerings")
      .select("id, title, price")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    target = any_published;
  }

  if (!target) {
    console.log("\nNo published offering to enroll into — run npm run seed first.");
    console.log("\nAccount ready:");
    console.log(`   ${EMAIL} / ${PASSWORD}`);
    return;
  }

  const { data: existing } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", userId)
    .eq("offering_id", target.id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("enrollments")
      .update({ status: "approved" })
      .eq("id", existing.id);
    console.log("Enrollment already present, set to approved.");
  } else {
    const { error } = await supabase.from("enrollments").insert({
      student_id: userId,
      offering_id: target.id,
      status: "approved",
      applicant_email: EMAIL,
      payment_amount: target.price ?? 0,
      payment_method: "bank_transfer",
      payment_receipt_url: "test/receipt.jpg",
    });
    if (error) {
      console.error("Error creating enrollment:", error.message);
      process.exit(1);
    }
    console.log(`Enrolled in "${target.title}" (approved).`);
  }

  await ensureLessons(target.id, target.title, userId);

  console.log("\nAccount ready:");
  console.log(`   ${EMAIL} / ${PASSWORD}  (admin, enrolled)`);
}

/**
 * The progress ring only renders when the offering has at least one lesson —
 * the dashboard card guards it on `count > 0`. A monthly offering seeded with
 * no curriculum makes the ring specs fail on a missing element rather than
 * skip, which is what happened to the Tajweed class locally.
 */
async function ensureLessons(
  offeringId: string,
  offeringTitle: string,
  instructorId: string
) {
  const { count } = await supabase
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("offering_id", offeringId);

  if ((count ?? 0) > 0) {
    console.log(`"${offeringTitle}" already has ${count} lesson(s).`);
    return;
  }

  const { data: subject, error: subjectError } = await supabase
    .from("subjects")
    .insert({
      offering_id: offeringId,
      title: "Foundations",
      slug: "foundations",
      description: "Introductory unit seeded for the end-to-end suite.",
      instructor_id: instructorId,
      sort_order: 0,
    })
    .select("id")
    .single();

  if (subjectError || !subject) {
    console.error("Error creating subject:", subjectError?.message);
    return;
  }

  // scheduled_at matters: partitionLessons() treats a lesson with neither a
  // schedule nor a live link as a downloadable-resource holder, not a class,
  // so an unscheduled lesson never reaches the lesson list or the ring.
  const start = new Date("2026-01-05T10:00:00.000Z");
  const lessons = [1, 2, 3, 4].map((n) => {
    const scheduledAt = new Date(start);
    scheduledAt.setUTCDate(start.getUTCDate() + (n - 1) * 7);
    return {
      offering_id: offeringId,
      subject_id: subject.id,
      title: `Lesson ${n}`,
      description: `Seeded lesson ${n} for the end-to-end suite.`,
      scheduled_at: scheduledAt.toISOString(),
      live_class_link: "https://example.com/live/seeded-class",
      sort_order: n,
      is_published: true,
    };
  });

  const { error: lessonError } = await supabase.from("lessons").insert(lessons);
  if (lessonError) {
    console.error("Error creating lessons:", lessonError.message);
    return;
  }

  console.log(
    `Seeded 1 subject and ${lessons.length} lessons into "${offeringTitle}".`
  );
}

main();
