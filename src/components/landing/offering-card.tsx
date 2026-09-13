/**
 * Public offering card — server component (no client JS until hover).
 *
 * Re-skinned onto the shared course vocabulary in `@/components/course` so the
 * catalogue, the offering page and the course workspace all read as one
 * product: `courseCard`'s white-on-cream shell with a rose hairline and soft
 * rose shadow, `courseCardHover`'s lift, the 38px tinted icon square from
 * `NavCard`, course pills, and a `courseButtonPrimary` CTA.
 *
 * The marketing polish that survives the re-skin, deliberately: the floral
 * `Sprig` corner mark that fades in on hover, the "New" badge, and the
 * short-description/price/CTA density a catalogue needs and a workspace
 * doesn't. What went is the rotating conic `border-beam` — it fought the rose
 * hairline `courseCardHover` paints, and only one of them can own the edge.
 *
 * Used in both the landing preview grid and the /catalog page.
 */
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Calendar,
  GraduationCap,
  MapPin,
  Presentation,
  Sparkles,
  Users,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  badgeBase,
  courseButtonPrimary,
  courseCard,
  courseCardHover,
  courseTag,
  iconTints,
  pillBase,
  pillTones,
} from "@/components/course/course-surface";
import { Sprig } from "./florals";
import { formatPriceWithFee } from "@/lib/constants";
import type { Offering, OfferingType } from "@/lib/types/database";

const TYPE_META: Record<
  OfferingType,
  { label: string; icon: React.ElementType }
> = {
  program: { label: "Program", icon: GraduationCap },
  course: { label: "Course", icon: BookOpen },
  workshop: { label: "Workshop", icon: Presentation },
  class: { label: "Class", icon: Users },
};

interface OfferingCardProps {
  offering: Offering;
}

export function OfferingCard({ offering }: OfferingCardProps) {
  const { label: typeLabel, icon: TypeIcon } = TYPE_META[offering.type];

  const ModeIcon = offering.mode === "onsite" ? MapPin : Wifi;
  const modeLabel =
    offering.mode === "onsite"
      ? "Onsite"
      : offering.mode === "hybrid"
      ? "Hybrid"
      : "Online";

  return (
    <Link
      href={`/offerings/${offering.slug}`}
      className={cn(
        courseCard,
        courseCardHover,
        "group relative flex flex-col overflow-hidden p-[18px]"
      )}
    >
      {/* Floral corner mark — fades in on hover so cards stay calm at rest */}
      <Sprig
        size={44}
        className="pointer-events-none absolute -top-2 -right-2 opacity-0 transition-opacity duration-300 group-hover:opacity-70"
      />

      {/* Icon square opposite the "New" badge — the NavCard top row */}
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "flex h-[38px] w-[38px] items-center justify-center rounded-[10px]",
            iconTints.brand
          )}
        >
          <TypeIcon className="h-[18px] w-[18px]" />
        </div>
        {offering.is_new && (
          <span
            className={cn(
              badgeBase,
              pillTones.warning,
              "inline-flex items-center gap-1"
            )}
          >
            <Sparkles className="h-2.5 w-2.5" />
            New
          </span>
        )}
      </div>

      {/* Meta chips */}
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <span className={cn(pillBase, pillTones.brand)}>{typeLabel}</span>
        <span className={cn(courseTag, "inline-flex items-center gap-1")}>
          <ModeIcon className="h-2.5 w-2.5" />
          {modeLabel}
        </span>
      </div>

      {/* Title */}
      <h3 className="font-heading mt-2.5 line-clamp-2 text-[15px] leading-snug font-semibold tracking-[-0.01em] transition-colors group-hover:text-rose-700 dark:group-hover:text-rose-300">
        {offering.title}
      </h3>

      {/* Description */}
      {offering.short_description && (
        <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-plum-body dark:text-muted-foreground">
          {offering.short_description}
        </p>
      )}

      {/* Start date */}
      {offering.schedule_start && (
        <span className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          Starts{" "}
          {new Date(offering.schedule_start).toLocaleDateString("en-PK", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      )}

      {/* Footer: price + CTA. The wrapper keeps a floor of 16px above the
          hairline on the tallest card in a row, where `mt-auto` collapses. */}
      <div className="mt-auto pt-4" />
      <div className="flex items-center justify-between gap-3 border-t border-border-soft pt-3.5 dark:border-border">
        <span className="font-heading text-[15px] font-bold text-rose-600 dark:text-rose-300">
          {formatPriceWithFee(offering.price, offering.fee_type)}
        </span>
        <span
          className={cn(
            courseButtonPrimary,
            "group-hover:border-rose-700 group-hover:bg-rose-700"
          )}
        >
          View details
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
