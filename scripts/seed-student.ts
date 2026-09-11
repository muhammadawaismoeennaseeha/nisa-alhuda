/**
 * Seed a test student with an approved enrollment.
 * Usage: npx tsx scripts/seed-student.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function seedStudent() {
  console.log("Creating test student...\n");

  // 1. Create student user
  const { data: authUser, error: authError } =
    await supabase.auth.admin.createUser({
      email: "student@nisaalhuda.com",
      password: "Student@123",
      email_confirm: true,
      user_metadata: { full_name: "Aisha Fatima" },
    });

  let studentId: string;

  if (authError && authError.message.includes("already been registered")) {
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existing = existingUsers?.users?.find(
      (u) => u.email === "student@nisaalhuda.com"
    );
    if (!existing) {
      console.error("Could not find existing student user");
      process.exit(1);
    }
    studentId = existing.id;
    console.log(`Student already exists: ${studentId}`);
  } else if (authError) {
    console.error("Error creating student:", authError.message);
    process.exit(1);
  } else {
    studentId = authUser!.user.id;
    console.log(`Created student: ${studentId}`);
  }

  // Ensure role is student
  await supabase
    .from("profiles")
    .update({ role: "student", phone: "+92 300 1234567" })
    .eq("id", studentId);

  console.log("Updated role to 'student'");

  // 2. Get the offering
  const { data: offering } = await supabase
    .from("offerings")
    .select("id, title")
    .eq("slug", "sisterhood-islamic-studies")
    .single();

  if (!offering) {
    console.error("Offering not found. Run seed.ts first.");
    process.exit(1);
  }

  console.log(`\nOffering: ${offering.title} (${offering.id})`);

  // 3. Check for existing enrollment
  const { data: existing } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", studentId)
    .eq("offering_id", offering.id)
    .single();

  if (existing) {
    // Update to approved
    await supabase
      .from("enrollments")
      .update({ status: "approved" })
      .eq("id", existing.id);
    console.log("Existing enrollment updated to approved.");
  } else {
    // Create approved enrollment
    const { error } = await supabase.from("enrollments").insert({
      student_id: studentId,
      offering_id: offering.id,
      status: "approved",
      payment_receipt_url: "test/receipt.jpg",
      payment_amount: 15000,
      payment_method: "bank_transfer",
      // NOT NULL since the guest-enrollment migrations: an enrollment always
      // records the address that applied, even when a student_id is attached.
      applicant_email: "student@nisaalhuda.com",
    });

    if (error) {
      console.error("Error creating enrollment:", error.message);
      process.exit(1);
    }
    console.log("Created approved enrollment.");
  }

  console.log("\n✅ Test student ready!");
  console.log("   Email: student@nisaalhuda.com");
  console.log("   Password: Student@123");
}

seedStudent().catch(console.error);
