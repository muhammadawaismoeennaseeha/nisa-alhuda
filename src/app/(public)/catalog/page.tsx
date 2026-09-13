/**
 * Public catalog page — lists offerings with Active / Archived tabs.
 *
 * Layout:
 *   - Hero banner with aurora backdrop (matches landing style)
 *   - Tab pill group
 *   - Empty state built on the course card surface, with a CTA
 *   - Uses the unified OfferingCard
 *
 * The marketing hero (aurora, drifting blossoms, floral divider) stays; the
 * cards and the empty state below it speak the shared course vocabulary from
 * `@/components/course`, so the eye carries one surface language from here
 * through the offering page and into the enrolled student's hub.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Archive, BookOpen, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { OfferingCard } from "@/components/landing/offering-card";
import { FloatingBlossoms, FloralDivider } from "@/components/landing/florals";
import {
  courseButtonPrimary,
  courseCard,
  iconTints,
} from "@/components/course/course-surface";
import type { Offering } from "@/lib/types/database";

export const metadata: Metadata = {
  title: "Catalog",
  description:
    "Browse our programs, courses, and workshops in Islamic studies.",
};

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const isArchived = tab === "archived";
  const supabase = await createClient();

  const { data: offerings } = await supabase
    .from("offerings")
    .select("*")
    .eq("status", isArchived ? "archived" : "published")
    .order("is_new", { ascending: false })
    .order("schedule_start", { ascending: false, nullsFirst: false });

  const list = (offerings ?? []) as Offering[];

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden py-16 md:py-20">
        <div className="absolute inset-0 -z-20 aurora opacity-60" aria-hidden />
        <div className="absolute inset-0 -z-10 grid-fade" aria-hidden />
        <FloatingBlossoms className="-z-10" />

        <div className="container relative mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white/70 px-4 py-1.5 text-xs font-semibold text-rose-700 backdrop-blur-md dark:border-rose-800 dark:bg-card/60 dark:text-rose-200">
            <Sparkles className="h-3.5 w-3.5" />
            Current catalog
          </div>
          <h1 className="font-heading mt-6 text-4xl leading-[1.1] font-bold tracking-[-0.01em] text-balance sm:text-5xl md:text-6xl">
            Find your path of knowledge
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-plum-body dark:text-muted-foreground">
            Browse our programs, courses, and workshops. Every offering is led
            by qualified female instructors and includes lifetime access to
            recordings.
          </p>

          {/* Tabs — pill group on the course surface's rose */}
          <div className="mt-10 inline-flex rounded-full border border-border-soft bg-card/80 p-1 shadow-soft-rose backdrop-blur-md dark:border-border dark:shadow-none">
            <Link
              href="/catalog"
              className={cn(
                "inline-flex h-9 items-center rounded-full px-5 text-[13px] font-semibold transition-colors",
                !isArchived
                  ? "bg-rose-500 text-white"
                  : "text-muted-foreground hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-200"
              )}
            >
              <BookOpen className="mr-1.5 h-3.5 w-3.5" />
              Active
            </Link>
            <Link
              href="/catalog?tab=archived"
              className={cn(
                "inline-flex h-9 items-center rounded-full px-5 text-[13px] font-semibold transition-colors",
                isArchived
                  ? "bg-rose-500 text-white"
                  : "text-muted-foreground hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-200"
              )}
            >
              <Archive className="mr-1.5 h-3.5 w-3.5" />
              Archived
            </Link>
          </div>
        </div>
      </section>

      <FloralDivider className="container mx-auto px-4" />

      {/* Grid */}
      <section className="pb-20 pt-4">
        <div className="container mx-auto px-4">
          {list.length === 0 ? (
            <div
              className={cn(
                courseCard,
                "mx-auto flex max-w-md flex-col items-center px-6 py-14 text-center"
              )}
            >
              <div
                className={cn(
                  "flex h-[38px] w-[38px] items-center justify-center rounded-[10px]",
                  iconTints.brand
                )}
              >
                <BookOpen className="h-[18px] w-[18px]" />
              </div>
              <h2 className="font-heading mt-3.5 text-[15px] font-semibold">
                {isArchived
                  ? "Nothing archived yet"
                  : "New programs coming soon"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isArchived
                  ? "Past cohorts will appear here once they close."
                  : "Check back soon, or create a free account to be notified when enrollment opens."}
              </p>
              {!isArchived && (
                <Link
                  href="/register"
                  className={cn(courseButtonPrimary, "press mt-5")}
                >
                  Create free account
                </Link>
              )}
            </div>
          ) : (
            <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((offering) => (
                <OfferingCard key={offering.id} offering={offering} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
