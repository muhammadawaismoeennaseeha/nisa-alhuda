/**
 * Student fee statement page (Module 6, Level 4) — the student's own complete
 * fee picture: every enrollment (one-time + monthly), every cycle, resolved to
 * a pay state, with per-currency totals that never blend.
 *
 * Like the transcript, this deliberately uses the RLS-scoped client (not the
 * service role): a student may only ever read her own enrollments and monthly
 * payments, so the same page proves the row-level security is sufficient. It is
 * read-only — there is no receipt-upload or approval control here (that lives on
 * the existing monthly-payment page).
 */
import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { FeeStatementDocument } from "@/components/fees/fee-statement-document";
import { PrintFeesButton } from "@/components/fees/print-fees-button";
import { fetchFeeStatementForStudent } from "@/lib/fees";

export default async function StudentFeesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const data = await fetchFeeStatementForStudent(
    supabase,
    user.id,
    profile?.full_name ?? "Student"
  );

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="My fees"
        title="My Fee Statement"
        subtitle="Every course you're enrolled in, what's paid, what's in review, and what's due — kept separate by currency."
        icon={Wallet}
        actions={
          <div className="print:hidden">
            <PrintFeesButton />
          </div>
        }
      />

      <FeeStatementDocument data={data} />
    </div>
  );
}
