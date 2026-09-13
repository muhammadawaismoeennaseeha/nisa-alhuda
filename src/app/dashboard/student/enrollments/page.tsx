/**
 * Student Enrollments Page — shows all enrollments with status tracking.
 * Covers pending, approved, rejected, and Financial Assistance states.
 */
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { courseCard, courseTag } from "@/components/course/course-surface";
import { LinkButton } from "@/components/ui/link-button";
import { StatusBadge, STATUS_CONFIG, type StatusKey } from "@/components/ui/status-badge";
import {
  ClipboardList,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import type { Enrollment, Offering } from "@/lib/types/database";
import { formatPaidAmount } from "@/lib/constants";
import { FaReceiptUpload } from "./fa-receipt-upload";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";

/** An enrollment row with its offering joined in. */
type EnrollmentRow = Enrollment & { offering: Offering | null };

export default async function StudentEnrollmentsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("*, offering:offerings(*)")
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        icon={ClipboardList}
        title="My Enrollments"
        subtitle="Track the status of every program, course, and workshop you've signed up for."
      />

      {!enrollments || enrollments.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No enrollments yet"
          description="Browse our catalog and enroll in a program, course, or workshop to begin your journey."
          action={<LinkButton href="/offerings">Browse Catalog</LinkButton>}
        />
      ) : (
        <div className="space-y-3">
          {(enrollments as EnrollmentRow[]).map((enrollment) => {
            const offering = enrollment.offering as Offering;

            // ── FA state derivations ──
            const faRequested = !!enrollment.fa_requested;
            const faPendingReview =
              faRequested &&
              enrollment.fa_approved_amount === null &&
              enrollment.status === "pending";
            const faRejected =
              faRequested && enrollment.status === "rejected";
            const faFullWaiver =
              faRequested &&
              enrollment.fa_approved_amount === 0 &&
              enrollment.status === "approved";
            const faPartialApproved =
              faRequested &&
              enrollment.fa_approved_amount !== null &&
              enrollment.fa_approved_amount > 0;
            const faAwaitingReceipt =
              faPartialApproved &&
              enrollment.status === "pending" &&
              !enrollment.payment_receipt_url;
            const faReceiptUnderReview =
              faPartialApproved &&
              enrollment.status === "pending" &&
              !!enrollment.payment_receipt_url;

            // Derive canonical status key for this enrollment
            let statusKey: StatusKey;
            if (faPendingReview) statusKey = "fa-pending";
            else if (faAwaitingReceipt) statusKey = "fa-awaiting-receipt";
            else if (faReceiptUnderReview) statusKey = "fa-receipt-review";
            else if (faFullWaiver) statusKey = "fa-waived";
            else statusKey = enrollment.status as StatusKey;

            const { icon: StatusIcon, bubbleBg, bubbleColor } = STATUS_CONFIG[statusKey];

            return (
              <div
                key={enrollment.id}
                className={cn(
                  courseCard,
                  faAwaitingReceipt &&
                    "border-amber-400 bg-amber-50/30 dark:bg-amber-950/10"
                )}
              >
                <div className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Status icon */}
                    <div
                      className={`h-12 w-12 rounded-xl ${bubbleBg} flex items-center justify-center shrink-0`}
                    >
                      <StatusIcon className={`h-5 w-5 ${bubbleColor}`} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-heading truncate text-[15px] font-semibold">
                          {offering?.title}
                        </h3>
                        <StatusBadge status={statusKey} />
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          Enrolled on{" "}
                          {new Date(enrollment.created_at).toLocaleDateString(
                            "en-PK",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            }
                          )}
                        </span>
                        {enrollment.payment_amount > 0 && (
                          <span>
                            {formatPaidAmount(
                              Number(enrollment.payment_amount),
                              enrollment.payment_currency
                            )}
                          </span>
                        )}
                        {offering?.type && (
                          <span className={courseTag}>
                            {offering.type === "program"
                              ? "Program"
                              : offering.type === "course"
                                ? "Course"
                                : "Workshop"}
                          </span>
                        )}
                      </div>

                      {/* FA approval info for partial waiver */}
                      {faAwaitingReceipt && (
                        <div className="mt-3 p-3 rounded-lg bg-amber-100/70 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700">
                          <p className="text-sm text-amber-900 dark:text-amber-200">
                            <strong>
                              Your FA was approved for PKR{" "}
                              {Number(
                                enrollment.fa_approved_amount
                              ).toLocaleString()}
                            </strong>
                            . Please transfer this amount and upload your receipt
                            to complete enrollment.
                          </p>
                        </div>
                      )}

                      {/* FA receipt under review */}
                      {faReceiptUnderReview && (
                        <div className="mt-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                          <p className="text-xs text-blue-700 dark:text-blue-300">
                            Your receipt has been received and is being verified.
                            You&apos;ll be notified once approved.
                          </p>
                        </div>
                      )}

                      {/* FA under review */}
                      {faPendingReview && (
                        <div className="mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            Your Financial Assistance application is being
                            reviewed. You&apos;ll be notified of the decision
                            shortly.
                          </p>
                        </div>
                      )}

                      {/* FA fully waived */}
                      {faFullWaiver && (
                        <div className="mt-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                          <p className="text-xs text-green-700 dark:text-green-300">
                            Great news! Your fee has been fully waived. You can
                            start learning right away.
                          </p>
                        </div>
                      )}

                      {/* Rejection reason */}
                      {enrollment.status === "rejected" &&
                        enrollment.rejection_reason && (
                          <div className="mt-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                              <p className="text-xs text-red-700 dark:text-red-300">
                                {faRejected ? (
                                  <>
                                    <strong>Financial Assistance declined:</strong>{" "}
                                    {enrollment.rejection_reason}
                                  </>
                                ) : (
                                  enrollment.rejection_reason
                                )}
                              </p>
                            </div>
                          </div>
                        )}

                      {/* Review info */}
                      {enrollment.reviewed_at && !faAwaitingReceipt && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Reviewed on{" "}
                          {new Date(enrollment.reviewed_at).toLocaleDateString(
                            "en-PK",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            }
                          )}
                        </p>
                      )}
                    </div>

                    {/* Action */}
                    <div className="shrink-0">
                      {faAwaitingReceipt ? (
                        <FaReceiptUpload
                          enrollmentId={enrollment.id}
                          approvedAmount={enrollment.fa_approved_amount || 0}
                          offeringTitle={offering?.title || "this offering"}
                        />
                      ) : enrollment.status === "approved" ? (
                        <LinkButton
                          size="sm"
                          href={`/dashboard/student/offerings/${offering?.id}`}
                        >
                          Continue Learning
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </LinkButton>
                      ) : enrollment.status === "pending" ? (
                        <span className="text-xs text-muted-foreground italic">
                          {faPendingReview ? "FA review in progress…" : "Under review…"}
                        </span>
                      ) : (
                        <LinkButton
                          size="sm"
                          variant="outline"
                          href={`/offerings/${offering?.slug}/enroll`}
                        >
                          {faRejected ? "Re-apply for FA" : "Re-apply"}
                        </LinkButton>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
