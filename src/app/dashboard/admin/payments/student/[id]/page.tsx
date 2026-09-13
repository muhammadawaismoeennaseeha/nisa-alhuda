/**
 * Payments-scoped student statement (Level 4, billing gate) — the same full fee
 * statement staff see, but reachable inside /dashboard/admin/payments so the
 * By-course roster can drill into an individual student WITHOUT leaving the
 * billing gate. Needed because the instructor layout blocks treasurers, so the
 * roster (admin + treasurer) cannot link into /dashboard/instructor/*. Reuses
 * the exact same document + engine as the staff page — no logic duplicated.
 * Read-only.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/dashboard/page-header";
import { FeeStatementDocument } from "@/components/fees/fee-statement-document";
import { PrintFeesButton } from "@/components/fees/print-fees-button";
import { fetchFeeStatementForStudent } from "@/lib/fees";

export default async function PaymentsStudentFeesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: studentId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id)
    .single();

  // Same billing gate as the rest of /dashboard/admin/payments.
  if (profile?.role !== "admin" && profile?.role !== "treasurer") {
    return (
      <div className="py-20 text-center">
        <p className="font-medium text-destructive">Access denied.</p>
      </div>
    );
  }

  const admin = createAdminClient();

  const { data: student } = await admin
    .from("profiles")
    .select("id, full_name")
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
        href="/dashboard/admin/payments/by-course"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to courses
      </Link>

      <PageHeader
        eyebrow="Fees · student"
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
