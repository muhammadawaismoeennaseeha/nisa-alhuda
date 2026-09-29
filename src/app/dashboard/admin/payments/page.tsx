/**
 * Payment Ledger — pending manual bank transfer approvals with receipt lightbox.
 * Admin can view receipts in a full-screen lightbox, approve or reject.
 */
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPaidAmount } from "@/lib/constants";
import {
  DollarSign,
  Clock,
  CheckCircle,
  XCircle,
  CalendarDays,
  Globe,
  ClipboardList,
  Hourglass,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PaymentActions } from "./payment-actions";
import { MonthlyPaymentActions } from "./monthly-payment-actions";
import { ManualApproveButton } from "./manual-approve-button";
import { formatCycleMonth, formatMonthlyAmount } from "@/lib/monthly-payments";

export default async function PaymentLedgerPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id)
    .single();

  // Admin and treasurer both manage the payment queue; everyone else is blocked.
  if (profile?.role !== "admin" && profile?.role !== "treasurer") {
    return (
      <div className="text-center py-20">
        <p className="text-destructive font-medium">Access denied.</p>
      </div>
    );
  }

  // Fetch all enrollments sorted: pending first, then by date
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(
      "*, student:profiles!enrollments_student_id_fkey(full_name, phone), offering:offerings!enrollments_offering_id_fkey(title, price)"
    )
    .order("created_at", { ascending: false });

  const pending = (enrollments || []).filter((e) => e.status === "pending");
  const approved = (enrollments || []).filter((e) => e.status === "approved");
  const rejected = (enrollments || []).filter((e) => e.status === "rejected");

  // Fetch monthly renewal payments — pending first so treasurers land on
  // actionable work.
  const { data: monthlyPaymentsRaw } = await supabase
    .from("monthly_payments")
    .select(
      "*, student:profiles!monthly_payments_student_id_fkey(full_name, phone), offering:offerings!monthly_payments_offering_id_fkey(title)"
    )
    .order("cycle_month", { ascending: false });

  const monthlyPayments = (monthlyPaymentsRaw || []) as any[];
  const monthlyPending = monthlyPayments.filter((p) => p.status === "pending");
  // Hoisted once for the 'Awaiting Submission' day-counter (avoids
  // calling Date.now() inside the per-row JSX, which the
  // react-hooks/purity lint flags as impure-during-render).
  const nowMs = new Date().getTime();

  // Cron-created placeholders awaiting a receipt upload. We surface only
  // rows past a small grace window so the worklist stays actionable —
  // on cycle-start day every approved monthly sister has an 'owed' row,
  // but most pay within a few days. Per the Phase-1 plan: chase at T+5.
  const OWED_FOLLOWUP_DAYS_THRESHOLD = 5;
  const monthlyOwed = monthlyPayments.filter((p) => {
    if (p.status !== "owed") return false;
    const cycleStartMs = new Date(`${p.cycle_month}T00:00:00Z`).getTime();
    const days = Math.floor((nowMs - cycleStartMs) / (1000 * 60 * 60 * 24));
    return days >= OWED_FOLLOWUP_DAYS_THRESHOLD;
  });

  // Revenue stats — split by country/currency so admin sees each market separately.
  // PKR → Pakistani students, INR → Indian students, USD → International students.
  // Totals include both initial enrollment payments AND approved monthly renewals
  // so recurring revenue is reflected.
  const normalizeCurrency = (
    c: string | null | undefined
  ): "PKR" | "INR" | "USD" => {
    const u = (c || "").toUpperCase();
    if (u === "INR") return "INR";
    if (u === "USD") return "USD";
    return "PKR"; // default + legacy rows
  };

  const approvedMonthly = monthlyPayments.filter((p) => p.status === "approved");
  const pendingMonthly = monthlyPayments.filter((p) => p.status === "pending");

  const sumByCurrency = (
    rows: { amount: number; currency: string | null | undefined }[],
    target: "PKR" | "INR" | "USD"
  ) =>
    rows
      .filter((r) => normalizeCurrency(r.currency) === target)
      .reduce((sum, r) => sum + (r.amount || 0), 0);

  // Unified (amount, currency) rows across enrollments + monthly renewals.
  // Excludes payment_method='manual_approval' rows — those are admin-created
  // enrollments for stranded / duplicate / rescued students, granting LMS
  // access without representing money received. Counting them would inflate
  // revenue totals.
  const approvedRows = [
    ...approved
      .filter((e) => e.payment_method !== "manual_approval")
      .map((e) => ({
        amount: e.payment_amount || 0,
        currency: e.payment_currency,
      })),
    ...approvedMonthly.map((p: any) => ({
      amount: p.amount || 0,
      currency: p.currency,
    })),
  ];
  const pendingRows = [
    ...pending
      .filter((e) => e.payment_method !== "manual_approval")
      .map((e) => ({
        amount: e.payment_amount || 0,
        currency: e.payment_currency,
      })),
    ...pendingMonthly.map((p: any) => ({
      amount: p.amount || 0,
      currency: p.currency,
    })),
  ];

  const revenuePkr = sumByCurrency(approvedRows, "PKR");
  const revenueInr = sumByCurrency(approvedRows, "INR");
  const revenueUsd = sumByCurrency(approvedRows, "USD");
  const pendingPkr = sumByCurrency(pendingRows, "PKR");
  const pendingInr = sumByCurrency(pendingRows, "INR");
  const pendingUsd = sumByCurrency(pendingRows, "USD");

  return (
    <div>
      <PageHeader
        icon={ClipboardList}
        title="Payment Ledger"
        subtitle="Review manual bank transfers and manage payment approvals."
      />

      {/* Status counters */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-50 dark:bg-amber-950/20 flex items-center justify-center">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{pending.length}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-green-50 dark:bg-green-950/20 flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{approved.length}</p>
              <p className="text-xs text-muted-foreground">Approved</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue by market — Pakistan (PKR) / India (INR) / International (USD).
          Each card shows approved revenue + pending amount awaiting approval. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-8">
        <Card className="border-green-200 dark:border-green-900/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg" aria-hidden>🇵🇰</span>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pakistani Students
              </p>
            </div>
            <p className="text-2xl font-bold text-green-700 dark:text-green-500">
              PKR {revenuePkr.toLocaleString("en-PK")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Total approved (PKR)
              {pendingPkr > 0 && (
                <span className="block mt-0.5 text-amber-600">
                  PKR {pendingPkr.toLocaleString("en-PK")} pending
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="border-orange-200 dark:border-orange-900/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg" aria-hidden>🇮🇳</span>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Indian Students
              </p>
            </div>
            <p className="text-2xl font-bold text-orange-700 dark:text-orange-500">
              ₹{revenueInr.toLocaleString("en-IN")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Total approved (INR)
              {pendingInr > 0 && (
                <span className="block mt-0.5 text-amber-600">
                  ₹{pendingInr.toLocaleString("en-IN")} pending
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-200 dark:border-blue-900/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="h-4 w-4 text-blue-600" aria-hidden />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                International Students
              </p>
            </div>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-500">
              ${revenueUsd.toLocaleString("en-US")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Total approved (USD)
              {pendingUsd > 0 && (
                <span className="block mt-0.5 text-amber-600">
                  ${pendingUsd.toLocaleString("en-US")} pending
                </span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pending Approvals */}
      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="font-heading font-semibold text-lg mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            Pending Approvals
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              {pending.length}
            </Badge>
          </h2>

          <div className="space-y-3">
            {pending.map((enrollment: any) => (
              <Card
                key={enrollment.id}
                className="border-amber-200 dark:border-amber-800"
              >
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">
                          {(enrollment.student_details as any)?.first_name
                            ? `${(enrollment.student_details as any).first_name} ${(enrollment.student_details as any).last_name || ""}`.trim()
                            : enrollment.student?.full_name || enrollment.applicant_email || "Unknown"}
                        </h3>
                        <Badge variant="outline" className="text-amber-600">
                          Pending
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {enrollment.offering?.title}
                      </p>
                      <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {enrollment.payment_method === "manual_approval" ? (
                            <span className="text-muted-foreground">Manual</span>
                          ) : (
                            formatPaidAmount(
                              enrollment.payment_amount,
                              enrollment.payment_currency
                            )
                          )}
                        </span>
                        {enrollment.student?.phone && (
                          <span>{enrollment.student.phone}</span>
                        )}
                        <span>
                          {new Date(enrollment.created_at).toLocaleDateString(
                            "en-PK",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </span>
                      </div>
                    </div>
                    <PaymentActions
                      enrollmentId={enrollment.id}
                      status={enrollment.status}
                      receiptPath={enrollment.payment_receipt_url}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Awaiting Submission — cron-created 'owed' rows where the sister
          hasn't uploaded a receipt yet. Distinct from "Monthly Renewals
          pending" (those have receipts to approve). This is a chase-list. */}
      {monthlyOwed.length > 0 && (
        <section className="mb-8">
          <h2 className="font-heading font-semibold text-lg mb-4 flex items-center gap-2">
            <Hourglass className="h-5 w-5 text-slate-500" />
            Awaiting Submission
            <Badge variant="outline" className="text-slate-600 border-slate-300">
              {monthlyOwed.length}
            </Badge>
          </h2>

          <p className="text-xs text-muted-foreground mb-3">
            Monthly sisters whose current cycle started more than 5 days ago
            without a receipt upload yet — chase-list for the treasurer.
            Earlier in the cycle they&apos;re left alone.
          </p>

          <div className="space-y-3">
            {monthlyOwed.map((payment: any) => {
              // Days since the cycle started — quick at-a-glance signal for
              // who to follow up first. Cycle key is YYYY-MM-DD UTC; nowMs
              // is hoisted at the top of the page (purity lint).
              const cycleStart = new Date(`${payment.cycle_month}T00:00:00Z`);
              const daysSince = Math.max(
                0,
                Math.floor(
                  (nowMs - cycleStart.getTime()) / (1000 * 60 * 60 * 24)
                )
              );
              return (
                <Card
                  key={payment.id}
                  className="border-slate-200 dark:border-slate-800"
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold truncate">
                            {payment.student?.full_name || "Unknown"}
                          </h3>
                          <Badge
                            variant="outline"
                            className="text-slate-600 border-slate-300"
                          >
                            {formatCycleMonth(payment.cycle_month)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {payment.offering?.title}
                        </p>
                        <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {formatMonthlyAmount(
                              payment.amount,
                              payment.currency
                            )}
                          </span>
                          {payment.student?.phone && (
                            <span>{payment.student.phone}</span>
                          )}
                          <span>
                            {daysSince === 0
                              ? "Cycle just started"
                              : `${daysSince} day${daysSince === 1 ? "" : "s"} since cycle start`}
                          </span>
                        </div>
                      </div>
                      <ManualApproveButton
                        monthlyPaymentId={payment.id}
                        defaultAmount={Number(payment.amount) || 0}
                        currency={payment.currency || "PKR"}
                        studentName={payment.student?.full_name || "Sister"}
                        cycleLabel={formatCycleMonth(payment.cycle_month)}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Monthly Renewals — pending first, then history */}
      {monthlyPayments.length > 0 && (
        <section className="mb-8">
          <h2 className="font-heading font-semibold text-lg mb-4 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Monthly Renewals
            {monthlyPending.length > 0 && (
              <Badge
                variant="outline"
                className="text-amber-600 border-amber-300"
              >
                {monthlyPending.length} pending
              </Badge>
            )}
          </h2>

          {/* Pending cycles — action-required card list */}
          {monthlyPending.length > 0 && (
            <div className="space-y-3 mb-4">
              {monthlyPending.map((payment: any) => (
                <Card
                  key={payment.id}
                  className="border-amber-200 dark:border-amber-800"
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold truncate">
                            {payment.student?.full_name || "Unknown"}
                          </h3>
                          <Badge variant="outline" className="text-amber-600">
                            {formatCycleMonth(payment.cycle_month)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {payment.offering?.title}
                        </p>
                        <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {formatMonthlyAmount(
                              payment.amount,
                              payment.currency
                            )}
                          </span>
                          {payment.sender_name && (
                            <span>
                              <span className="opacity-70">Sent by:</span>{" "}
                              <span className="font-medium text-foreground">
                                {payment.sender_name}
                              </span>
                            </span>
                          )}
                          {payment.student?.phone && (
                            <span>{payment.student.phone}</span>
                          )}
                          <span>
                            Submitted{" "}
                            {new Date(payment.created_at).toLocaleDateString(
                              "en-PK",
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }
                            )}
                          </span>
                        </div>
                      </div>
                      <MonthlyPaymentActions
                        monthlyPaymentId={payment.id}
                        status={payment.status}
                        receiptPath={payment.receipt_url}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* History table */}
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Student
                  </th>
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Offering
                  </th>
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Cycle
                  </th>
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Amount
                  </th>
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Status
                  </th>
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthlyPayments.map((payment: any) => (
                  <tr key={payment.id} className="border-b last:border-0">
                    <td className="py-3 font-medium">
                      {payment.student?.full_name || "Unknown"}
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {payment.offering?.title}
                    </td>
                    <td className="py-3 text-muted-foreground whitespace-nowrap">
                      {formatCycleMonth(payment.cycle_month)}
                    </td>
                    <td className="py-3 whitespace-nowrap">
                      {formatMonthlyAmount(payment.amount, payment.currency)}
                    </td>
                    <td className="py-3">
                      <Badge
                        variant={
                          payment.status === "approved"
                            ? "default"
                            : payment.status === "rejected"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {payment.status}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <MonthlyPaymentActions
                        monthlyPaymentId={payment.id}
                        status={payment.status}
                        receiptPath={payment.receipt_url}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* All Transactions */}
      <section>
        <h2 className="font-heading font-semibold text-lg mb-4">
          All Transactions ({(enrollments || []).length})
        </h2>

        {!enrollments || enrollments.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title="No enrollment transactions yet"
            description="One-time enrollment payments will appear here once sisters register and submit a receipt."
          />
        ) : (
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Student
                  </th>
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Offering
                  </th>
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Amount
                  </th>
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Date
                  </th>
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Status
                  </th>
                  <th className="pb-3 font-medium text-muted-foreground whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {(enrollments || []).map((enrollment: any) => (
                  <tr key={enrollment.id} className="border-b last:border-0">
                    <td className="py-3 font-medium">
                      {(enrollment.student_details as any)?.first_name
                        ? `${(enrollment.student_details as any).first_name} ${(enrollment.student_details as any).last_name || ""}`.trim()
                        : enrollment.student?.full_name || enrollment.applicant_email || "Unknown"}
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {enrollment.offering?.title}
                    </td>
                    <td className="py-3 whitespace-nowrap">
                      {enrollment.payment_method === "manual_approval" ? (
                        <span className="text-muted-foreground">Manual</span>
                      ) : (
                        formatPaidAmount(
                          enrollment.payment_amount,
                          enrollment.payment_currency
                        )
                      )}
                    </td>
                    <td className="py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(enrollment.created_at).toLocaleDateString(
                        "en-PK",
                        { day: "numeric", month: "short", year: "numeric" }
                      )}
                    </td>
                    <td className="py-3">
                      <Badge
                        variant={
                          enrollment.status === "approved"
                            ? "default"
                            : enrollment.status === "pending"
                              ? "outline"
                              : "destructive"
                        }
                      >
                        {enrollment.status}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <PaymentActions
                        enrollmentId={enrollment.id}
                        status={enrollment.status}
                        receiptPath={enrollment.payment_receipt_url}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
