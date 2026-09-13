/**
 * Course Management — list all offerings with feature/archive capabilities.
 * Admin can feature courses on homepage or archive old ones.
 */
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { formatPriceWithFee } from "@/lib/constants";
import { Plus, BookOpen, LayoutGrid, Users, Lock } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { DeleteOffering } from "./delete-offering";
import { OfferingToggles } from "./offering-toggles";
import type { Offering } from "@/lib/types/database";

const statusConfig = {
  draft: { label: "Draft", variant: "outline" as const },
  published: { label: "Published", variant: "default" as const },
  archived: { label: "Archived", variant: "secondary" as const },
};

const typeLabels = {
  program: "Program",
  course: "Course",
  workshop: "Workshop",
  class: "Class",
};

export default async function AdminOfferingsPage() {
  const supabase = await createClient();

  // Instructor-vs-admin viewing context. Admin layout already gates
  // unauthorised roles; here we just need the role to decide whether
  // to render the price column (hidden from instructors per spec).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()
    : { data: null };
  const hideFinance = profile?.role === "instructor";

  const { data, error } = await supabase
    .from("offerings")
    .select("*")
    .order("created_at", { ascending: false });
  const offerings = (data || []) as Offering[];

  if (error) {
    console.error("Error fetching offerings:", error);
  }

  // Fetch approved enrollment counts per offering
  const { data: enrollmentCounts } = await supabase
    .from("enrollments")
    .select("offering_id")
    .eq("status", "approved");

  const countByOffering: Record<string, number> = {};
  (enrollmentCounts || []).forEach((e: { offering_id: string }) => {
    countByOffering[e.offering_id] = (countByOffering[e.offering_id] || 0) + 1;
  });

  const published = offerings.filter((o) => o.status === "published").length;
  const featured = offerings.filter((o) => o.is_featured).length;
  const archived = offerings.filter((o) => o.status === "archived").length;
  const closed = offerings.filter((o) => o.admission_closed).length;

  return (
    <div>
      <PageHeader
        icon={BookOpen}
        title="Course Management"
        subtitle="Manage programs, courses, and workshops. Feature them on the homepage or archive old ones."
        actions={
          <LinkButton
            href="/dashboard/admin/offerings/new"
            className="press rounded-full"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Offering
          </LinkButton>
        }
      />

      {/* Quick stats */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Badge variant="outline" className="text-sm py-1 px-3">
          {(offerings || []).length} total
        </Badge>
        <Badge variant="default" className="text-sm py-1 px-3">
          {published} published
        </Badge>
        {featured > 0 && (
          <Badge
            variant="outline"
            className="text-sm py-1 px-3 text-amber-600 border-amber-300"
          >
            {featured} featured
          </Badge>
        )}
        {archived > 0 && (
          <Badge variant="secondary" className="text-sm py-1 px-3">
            {archived} archived
          </Badge>
        )}
        {closed > 0 && (
          <Badge
            variant="outline"
            className="text-sm py-1 px-3 text-destructive border-destructive/30"
          >
            <Lock className="h-3 w-3 mr-1" />
            {closed} closed
          </Badge>
        )}
      </div>

      {offerings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-lg mb-4">
              No offerings yet
            </p>
            <LinkButton href="/dashboard/admin/offerings/new">
              Create Your First Offering
            </LinkButton>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {offerings.map((offering) => {
            const status = statusConfig[offering.status] || statusConfig.draft;
            return (
              <Card
                key={offering.id}
                className={offering.status === "archived" ? "opacity-60" : ""}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Thumbnail placeholder */}
                    <div className="h-16 w-24 rounded-lg bg-secondary kufic-pattern flex items-center justify-center shrink-0 relative">
                      <BookOpen className="h-6 w-6 text-primary/20" />
                      {offering.is_featured && (
                        <div className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-amber-400 flex items-center justify-center text-white text-xs font-bold">
                          ★
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">
                          {offering.title}
                        </h3>
                        <Badge variant={status.variant}>{status.label}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {typeLabels[offering.type as keyof typeof typeLabels]}
                        </Badge>
                        {offering.is_featured && (
                          <Badge
                            variant="outline"
                            className="text-xs text-amber-600 border-amber-300"
                          >
                            Featured
                          </Badge>
                        )}
                        {offering.admission_closed && (
                          <Badge
                            variant="outline"
                            className="text-xs text-destructive border-destructive/30"
                          >
                            Admission Closed
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {offering.short_description || offering.description}
                      </p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        {!hideFinance && (
                          <span>{formatPriceWithFee(offering.price, offering.fee_type)}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {countByOffering[offering.id] || 0} enrolled
                        </span>
                        {offering.schedule_start && (
                          <span>
                            Starts{" "}
                            {new Date(
                              offering.schedule_start
                            ).toLocaleDateString("en-PK", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        )}
                        <span>/offerings/{offering.slug}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <OfferingToggles
                        offeringId={offering.id}
                        isFeatured={offering.is_featured || false}
                        status={offering.status}
                        admissionClosed={offering.admission_closed || false}
                      />
                      {/* The course workspace is the single way in: its tabs
                          own the roster (People) and the offering form
                          (Details), so there is no separate Students or Edit
                          button here any more. */}
                      <LinkButton
                        size="sm"
                        href={`/dashboard/admin/offerings/${offering.id}/workspace`}
                      >
                        <LayoutGrid className="h-3.5 w-3.5 mr-1.5" />
                        Manage
                      </LinkButton>
                      <DeleteOffering
                        offeringId={offering.id}
                        offeringTitle={offering.title}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
