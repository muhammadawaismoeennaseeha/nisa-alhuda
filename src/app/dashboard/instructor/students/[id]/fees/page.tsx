/**
 * Staff fee statement page (Module 6, Level 4) — view any student's complete
 * fee statement. Reachable by any staff member (admins and instructors already
 * read every student's enrollments on the students roster). Read-only: reviewing
 * and recording payments stays on the existing admin payments pages.
 */
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardViewer } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/dashboard/page-header";
import { FeeStatementDocument } from "@/components/fees/fee-statement-document";
import { PrintFeesButton } from "@/components/fees/print-fees-button";
import { fetchFeeStatementForStudent } from "@/lib/fees";

export default async function StaffFeesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: studentId } = await params;
  const viewer = await getDashboardViewer();
  if (!viewer) return null;
  // Teaching staff who are NOT financial: a student never sees this, and a
  // Teaching Assistant is teaching-only — fees are financial data and must
  // stay out of their reach even though they share the instructor area.
  // (This page reads through the service-role client, which bypasses RLS,
  // so this gate is the only thing standing between a TA and fee data.)
  if (viewer.role === "student" || viewer.role === "ta") {
    redirect("/dashboard/instructor");
  }

  const admin = createAdminClient();

  const { data: student } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", studentId)
    .single();
  if (!student) notFound();

  const data = await fetchFeeStatementForStudent(
    admin,
    studentId,
    student.full_name
  );

  return (
    <div className="pb-10">
      <Link
        href="/dashboard/instructor/students"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to students
      </Link>

      <PageHeader
        eyebrow="Student records"
        title={student.full_name}
        subtitle="Fee statement — every enrollment, every cycle, kept separate by currency."
        icon={Wallet}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <PrintFeesButton />
          </div>
        }
      />

      <FeeStatementDocument data={data} />
    </div>
  );
}
