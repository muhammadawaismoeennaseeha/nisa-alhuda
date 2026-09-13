/**
 * Monthly Payment Card — shown to students enrolled in monthly-fee offerings.
 * Lists every cycle from enrollment → current month, with status badge for
 * each cycle and an upload affordance for cycles that are missing or rejected.
 *
 * This is a server component that wraps the client uploader for the active
 * (unpaid or rejected) cycle — passing all cycles down as props.
 */
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import {
  CheckCircle,
  CalendarDays,
  AlertCircle,
  HeartHandshake,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { courseCard } from "@/components/course/course-surface";
import {
  cyclesBetween,
  firstOfMonth,
  formatCycleMonth,
  formatCyclePeriod,
  formatMonthlyAmount,
} from "@/lib/monthly-payments";
import { ReceiptLink } from "./receipt-link";
import type { MonthlyPayment } from "@/lib/types/database";
import { MonthlyPaymentUploader } from "./monthly-payment-uploader";

function cycleStatusKey(payment?: MonthlyPayment): StatusKey {
  if (!payment) return "unpaid";
  if (payment.status === "approved") return "paid";
  if (payment.status === "rejected") return "rejected";
  if (payment.status === "owed") return "owed";
  return "pending";
}

interface MonthlyPaymentCardProps {
  enrollmentId: string;
  enrolledAt: string;
  monthlyAmount: number;
  currency: string;
  payments: MonthlyPayment[];
}

export function MonthlyPaymentCard({
  enrollmentId,
  enrolledAt,
  monthlyAmount,
  currency,
  payments,
}: MonthlyPaymentCardProps) {
  // Full-waiver branch: FA-approved with 0 reduced fee on a monthly offering.
  // The student owes nothing — show a celebratory fee-waived card instead of
  // the uploader + payment history, which would otherwise show "PKR 0 per month"
  // and an upload prompt for nothing.
  if (monthlyAmount === 0) {
    return <FullyWaivedCard />;
  }

  const currentCycle = firstOfMonth();
  const cycles = cyclesBetween(enrolledAt).reverse(); // newest first

  // Index payments by cycle for O(1) lookup
  const byCycle: Record<string, MonthlyPayment> = {};
  for (const p of payments) {
    byCycle[p.cycle_month] = p;
  }

  const currentPayment = byCycle[currentCycle];
  const needsUploadForCurrent =
    !currentPayment ||
    currentPayment.status === "rejected" ||
    currentPayment.status === "owed";

  // Count unpaid (missing or rejected) cycles
  const unpaidCount = cycles.filter((c) => {
    const p = byCycle[c];
    return !p || p.status === "rejected";
  }).length;

  return (
    <div className={courseCard}>
      <div className="p-4 md:p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <CalendarDays className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-heading font-semibold">
              Monthly Subscription
            </h2>
            <p className="text-xs text-muted-foreground">
              {formatMonthlyAmount(monthlyAmount, currency)} per month
            </p>
          </div>
          {unpaidCount > 0 ? (
            <Badge
              variant="outline"
              className="border-amber-300 text-amber-700 dark:text-amber-400"
            >
              <AlertCircle className="h-3 w-3 mr-1" />
              {unpaidCount} month{unpaidCount !== 1 ? "s" : ""} due
            </Badge>
          ) : (
            <Badge variant="outline" className="border-green-300 text-green-700 dark:text-green-400">
              <CheckCircle className="h-3 w-3 mr-1" />
              All paid up
            </Badge>
          )}
        </div>

        {/* Current cycle: uploader if not yet paid, status if already submitted */}
        <div className="rounded-lg border bg-muted/30 p-3 md:p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium uppercase text-muted-foreground tracking-wide">
              Current Cycle · {formatCycleMonth(currentCycle)}
            </p>
            <StatusBadge status={cycleStatusKey(currentPayment)} />
          </div>

          {needsUploadForCurrent ? (
            <MonthlyPaymentUploader
              enrollmentId={enrollmentId}
              cycleMonth={currentCycle}
              amount={monthlyAmount}
              currency={currency}
              rejectedReason={
                currentPayment?.status === "rejected"
                  ? currentPayment.rejection_reason
                  : null
              }
            />
          ) : currentPayment?.status === "pending" ? (
            <p className="text-sm text-muted-foreground">
              Your receipt is under review. You&apos;ll see confirmation here
              once it&apos;s approved.
            </p>
          ) : (
            <p className="text-sm text-green-700 dark:text-green-400">
              Paid and approved. Next cycle opens on the 1st of next month.
            </p>
          )}
        </div>

        {/* Billing history — receipt-like statement cards */}
        {cycles.length > 1 && (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground tracking-wide mb-2">
              Billing History
            </p>
            <div className="space-y-2">
              {cycles.slice(1).map((cycle) => {
                const payment = byCycle[cycle];
                const sk = cycleStatusKey(payment);
                const displayAmount = payment
                  ? formatMonthlyAmount(payment.amount, payment.currency)
                  : formatMonthlyAmount(monthlyAmount, currency);

                const borderClass: Record<string, string> = {
                  paid:    "border-green-200 dark:border-green-900",
                  pending: "border-amber-200 dark:border-amber-900",
                  rejected:"border-destructive/40",
                  owed:    "border-slate-200 dark:border-slate-700",
                  unpaid:  "border-slate-200 dark:border-slate-700",
                };
                const headerClass: Record<string, string> = {
                  paid:    "bg-green-50/80 dark:bg-green-950/20 border-green-200 dark:border-green-900",
                  pending: "bg-amber-50/80 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900",
                  rejected:"bg-destructive/5 border-destructive/30",
                  owed:    "bg-muted/40 border-slate-200 dark:border-slate-700",
                  unpaid:  "bg-muted/40 border-slate-200 dark:border-slate-700",
                };

                return (
                  <div
                    key={cycle}
                    className={cn("rounded-lg border overflow-hidden", borderClass[sk])}
                  >
                    {/* Receipt header strip — status badge + cycle label */}
                    <div className={cn("flex items-center justify-between px-3 py-1.5 border-b", headerClass[sk])}>
                      <StatusBadge status={sk} />
                      <span className="text-xs text-muted-foreground font-medium">
                        {formatCycleMonth(cycle)}
                      </span>
                    </div>

                    {/* Receipt body — period, amount, contextual note, receipt link */}
                    <div className="p-3 flex items-end justify-between gap-2 bg-card">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {formatCyclePeriod(cycle)}
                        </p>
                        <p className="text-lg font-bold mt-0.5">{displayAmount}</p>
                        {payment?.status === "rejected" && payment.rejection_reason && (
                          <p className="text-xs text-destructive mt-1.5 flex items-start gap-1">
                            <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>{payment.rejection_reason}</span>
                          </p>
                        )}
                        {!payment && (
                          <p className="text-xs text-muted-foreground italic mt-1">
                            No receipt on file
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {payment?.receipt_url && (
                          <ReceiptLink storagePath={payment.receipt_url} />
                        )}
                        {!payment?.receipt_url &&
                          payment?.payment_method === "admin_recorded" && (
                            <span className="text-xs text-muted-foreground italic">
                              Manually recorded
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Rendered when the student has a full fee waiver on a monthly offering.
 * No uploader, no payment history — just a warm acknowledgement that they
 * owe nothing and can focus on learning.
 */
function FullyWaivedCard() {
  return (
    <div className={cn(courseCard, "bg-gradient-to-br from-rose-50 via-transparent to-transparent dark:from-rose-950/30")}>
      <div className="p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <HeartHandshake className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-heading font-semibold">
                Monthly Subscription
              </h2>
              <Badge
                variant="outline"
                className="border-primary/40 text-primary"
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                Fully waived
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Your financial assistance request was approved with a full waiver —
              no monthly fee. Focus on your learning, and may Allah bless your
              journey.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

