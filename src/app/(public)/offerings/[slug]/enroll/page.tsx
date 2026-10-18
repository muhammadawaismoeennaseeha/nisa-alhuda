/**
 * Enrollment Page — guest-friendly enrollment for any offering.
 *
 * No login required. Three paths:
 *   PATH 1 (Express): Already logged in → pre-filled, fast enrollment
 *   PATH 2 (Returning): Email found → prompt to log in or continue
 *   PATH 3 (New): Brand new → full form
 *
 * Free offerings skip the payment step entirely.
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PROFILE_SELECT } from "@/lib/db/profiles";
import { createAdminClient } from "@/lib/supabase/admin";
import { EnrollmentWizard } from "./enrollment-wizard";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Clock, Lock } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import type { Offering, Profile, StudentDetails } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Enroll",
  description: "Enroll in our Islamic studies programs, courses, and workshops.",
};

const typeLabels: Record<string, string> = {
  program: "Program",
  course: "Course",
  workshop: "Workshop",
  class: "Class",
};

export default async function EnrollPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  // Fetch offering (public — no auth needed)
  const { data: offering } = await supabase
    .from("offerings")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .single<Offering>();

  if (!offering) notFound();

  // If admission is closed, block enrollment
  if (offering.admission_closed) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <Card className="glass">
          <CardContent className="p-8 text-center">
            <Lock className="h-16 w-16 text-destructive mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Admission Closed</h1>
            <p className="text-muted-foreground mb-6">
              This offering is no longer accepting new enrollments.
            </p>
            <LinkButton href="/catalog" variant="outline">
              Browse Catalog
            </LinkButton>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if user is logged in (optional — not required)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: Profile | null = null;
  let userEmail = "";
  let previousDetails: StudentDetails | null = null;

  if (user) {
    // Fetch profile for pre-filling
    const { data: p } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", user.id)
      .single<Profile>();
    profile = p;
    userEmail = user.email || "";

    // Check for existing enrollment in THIS offering
    const admin = createAdminClient();
    const { data: existingEnrollment } = await admin
      .from("enrollments")
      .select("id, status")
      .eq("applicant_email", userEmail.toLowerCase())
      .eq("offering_id", offering.id)
      .single();

    // If already enrolled, show status
    if (existingEnrollment) {
      return (
        <div className="container mx-auto px-4 py-12 max-w-2xl">
          <Card className="glass">
            <CardContent className="p-8 text-center">
              {existingEnrollment.status === "pending" ? (
                <>
                  <Clock className="h-16 w-16 text-primary mx-auto mb-4" />
                  <h1 className="text-2xl font-bold mb-2">Application Under Review</h1>
                  <p className="text-muted-foreground mb-6">
                    Your application for <strong>{offering.title}</strong> is being
                    reviewed. We&apos;ll get back to you within 24 hours. Keep
                    checking your email!
                  </p>
                  <LinkButton href="/catalog" variant="outline">
                    Browse More Programs
                  </LinkButton>
                </>
              ) : existingEnrollment.status === "approved" ? (
                <>
                  <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
                  <h1 className="text-2xl font-bold mb-2">Already Enrolled!</h1>
                  <p className="text-muted-foreground mb-6">
                    You&apos;re already enrolled in <strong>{offering.title}</strong>.
                    Head to your dashboard to start learning.
                  </p>
                  <LinkButton href="/dashboard/student">
                    Go to Dashboard
                  </LinkButton>
                </>
              ) : (
                <>
                  <Clock className="h-16 w-16 text-destructive mx-auto mb-4" />
                  <h1 className="text-2xl font-bold mb-2">Application Not Approved</h1>
                  <p className="text-muted-foreground mb-6">
                    Your previous application was not approved. Please contact support
                    or re-apply below.
                  </p>
                  <LinkButton href="/catalog" variant="outline">
                    Browse Catalog
                  </LinkButton>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    // Fetch previous enrollment's student_details for pre-fill
    const { data: prevEnrollment } = await admin
      .from("enrollments")
      .select("student_details")
      .eq("applicant_email", userEmail.toLowerCase())
      .not("student_details", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (prevEnrollment?.student_details) {
      previousDetails = prevEnrollment.student_details as StudentDetails;
    }
  }

  // Split full_name into first/last for pre-fill
  const nameParts = (profile?.full_name || "").split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="text-center mb-8">
        <span className="inline-block text-xs font-medium uppercase tracking-wider text-primary bg-secondary px-3 py-1 rounded-full mb-3">
          {typeLabels[offering.type] || offering.type}
        </span>
        <h1 className="text-3xl font-bold mb-2">Enroll in {offering.title}</h1>
        <p className="text-muted-foreground">
          Complete the steps below to submit your application.
        </p>
      </div>

      <EnrollmentWizard
        offeringId={offering.id}
        offeringTitle={offering.title}
        offeringType={offering.type}
        offeringPrice={offering.price}
        offeringPriceInr={offering.price_inr}
        offeringPriceUsd={offering.price_usd}
        offeringFeeType={offering.fee_type}
        offeringSlug={offering.slug}
        isLoggedIn={!!user}
        userEmail={userEmail}
        prefill={{
          firstName: previousDetails?.first_name || firstName,
          lastName: previousDetails?.last_name || lastName,
          phone: previousDetails?.phone || profile?.phone || "",
          city: previousDetails?.city || "",
          country: previousDetails?.country || "Pakistan",
          age: previousDetails?.age || "",
          educationLevel: previousDetails?.education_level || "",
          referralSource: previousDetails?.referral_source || "",
        }}
      />
    </div>
  );
}
