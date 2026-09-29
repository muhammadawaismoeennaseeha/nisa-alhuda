/**
 * Monthly Payment — dedicated receipt-upload page for a single
 * enrollment + the current billing cycle.
 *
 * Mirrors the layout of the initial enrollment receipt screen so
 * sisters see a familiar UI when paying their monthly fee:
 *  - Left card: Payment Details (amount + bank info for her currency)
 *  - Right card: Upload Receipt (sender name pre-filled + file picker)
 *
 * Routed from the "Pay your [month] fee" banner on the student
 * dashboard. Each enrollment has at most one billable cycle in
 * flight at any time, so the URL only carries the enrollment id —
 * the page resolves the cycle server-side.
 */
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Clock, Wallet } from "lucide-react";
import {
  firstOfMonth,
  cyclesBetween,
  formatCycleMonth,
  monthlyAmountForEnrollment,
} from "@/lib/monthly-payments";
import type {
  Enrollment,
  Offering,
  Profile,
  MonthlyPayment,
} from "@/lib/types/database";
import { MonthlyPaymentForm, type Region } from "./monthly-payment-form";

interface PageProps {
  params: Promise<{ enrollmentId: string }>;
}

function regionFromCurrency(currency: string): Region {
  const c = (currency || "PKR").toUpperCase();
  if (c === "INR") return "in";
  if (c === "USD") return "intl";
  return "pk";
}

export default async function MonthlyPaymentPage({ params }: PageProps) {
  const { enrollmentId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single<Pick<Profile, "full_name">>();

  type EnrollmentRow = Enrollment & {
    offering: Pick<
      Offering,
      "id" | "title" | "fee_type" | "price" | "price_inr" | "price_usd"
    > | null;
  };

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select(
      "id, student_id, offering_id, status, payment_method, payment_currency, fa_approved_amount, created_at, offering:offerings!enrollments_offering_id_fkey(id, title, fee_type, price, price_inr, price_usd)"
    )
    .eq("id", enrollmentId)
    .single<EnrollmentRow>();

  // Guard: enrollment exists + belongs to this user + is approved + monthly.
  if (!enrollment || enrollment.student_id !== user.id) {
    redirect("/dashboard/student");
  }
  if (enrollment.status !== "approved") {
    return (
      <NoticeCard
        icon={<Clock className="h-5 w-5 text-amber-600" />}
        title="Enrollment not yet approved"
        body="Your initial enrollment is still under review. Monthly payments unlock automatically once an admin approves you."
      />
    );
  }
  if (!enrollment.offering || enrollment.offering.fee_type !== "monthly") {
    return (
      <NoticeCard
        icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
        title="This course is not on a monthly plan"
        body="No recurring payment is required — you're set."
      />
    );
  }

  // Non-billable enrollments (rescue rows, full waivers, promo comps,
  // FA-fully-waived) don't owe a monthly fee. Bounce with a friendly
  // notice instead of showing a "PKR 0" form.
  const NON_BILLABLE_METHODS = new Set([
    "manual_approval",
    "waiver",
    "free",
  ]);
  if (
    (enrollment.payment_method &&
      NON_BILLABLE_METHODS.has(enrollment.payment_method)) ||
    enrollment.fa_approved_amount === 0
  ) {
    return (
      <NoticeCard
        icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
        title="No monthly fee on this enrollment"
        body="Your access is on a free / waiver / admin-granted basis — no payment is required. Jazakillahu khairan!"
      />
    );
  }

  const currentCycle = firstOfMonth();
  const owedCycles = cyclesBetween(enrollment.created_at);

  // Defensive: should only land here when the dashboard banner pushed
  // the sister in. If the cycle isn't even owed yet, send her home.
  if (!owedCycles.includes(currentCycle)) {
    return (
      <NoticeCard
        icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
        title="Nothing due right now"
        body="There's no monthly fee outstanding for your account this cycle."
      />
    );
  }

  // Look up any existing row for this cycle. If she already paid /
  // submitted, short-circuit so we don't show the form again.
  const { data: existing } = await supabase
    .from("monthly_payments")
    .select("id, status, rejection_reason")
    .eq("enrollment_id", enrollment.id)
    .eq("cycle_month", currentCycle)
    .maybeSingle<Pick<MonthlyPayment, "id" | "status" | "rejection_reason">>();

  if (existing?.status === "approved") {
    return (
      <NoticeCard
        icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
        title={`${formatCycleMonth(currentCycle)} fee already paid`}
        body="An admin has approved your receipt for this cycle. Jazakillahu khairan!"
      />
    );
  }

  if (existing?.status === "pending") {
    return (
      <NoticeCard
        icon={<Clock className="h-5 w-5 text-amber-600" />}
        title={`Receipt under review`}
        body={`Your receipt for ${formatCycleMonth(currentCycle)} is being reviewed. You'll be notified once it's approved.`}
      />
    );
  }

  // Compute amount + region for the form (honors FA reduced fee).
  const { amount, currency } = monthlyAmountForEnrollment(
    enrollment.offering,
    enrollment
  );
  const region = regionFromCurrency(currency);
  // FA-partial: surface the reduced rate badge + the offering's full price
  // so the sister can see "you're paying PKR 1,000 instead of PKR 3,000".
  const isFaReduced =
    enrollment.fa_approved_amount != null &&
    enrollment.fa_approved_amount > 0;
  const fullPrice = (() => {
    if (currency === "USD") return enrollment.offering.price_usd ?? null;
    if (currency === "INR") return enrollment.offering.price_inr ?? null;
    return enrollment.offering.price ?? null;
  })();

  return (
    <div>
      <PageHeader
        icon={Wallet}
        title={`Pay ${formatCycleMonth(currentCycle)} fee`}
        subtitle={`${enrollment.offering.title} · ${currency} ${amount.toLocaleString()} · monthly subscription`}
      />

      <MonthlyPaymentForm
        enrollmentId={enrollment.id}
        offeringTitle={enrollment.offering.title}
        cycleMonth={currentCycle}
        cycleLabel={formatCycleMonth(currentCycle)}
        amount={amount}
        currency={currency}
        isFaReduced={isFaReduced}
        fullPrice={fullPrice}
        defaultRegion={region}
        hasIntlPrice={enrollment.offering.price_usd != null}
        hasInrPrice={enrollment.offering.price_inr != null}
        defaultSenderName={profile?.full_name || ""}
        previousRejectionReason={
          existing?.status === "rejected" ? existing.rejection_reason : null
        }
      />
    </div>
  );
}

function NoticeCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardContent className="p-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            {icon}
          </div>
          <h2 className="mb-2 font-heading text-lg font-semibold">{title}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{body}</p>
          <LinkButton href="/dashboard/student" variant="outline">
            Back to dashboard
          </LinkButton>
        </CardContent>
      </Card>
    </div>
  );
}
