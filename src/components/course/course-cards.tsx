/**
 * The card vocabulary the course Overview is built from.
 *
 * Restyled to the signed-off courses mockup: MetricCard is a tinted icon square
 * over a large tabular number, NavCard/LinkCard put that same square opposite a
 * chevron and lift on hover. NavCard moves to another tab on this page;
 * LinkCard leaves for another screen, deep-linked to this course.
 *
 * Every card is `min-w-0` and truncates its detail line: course names, schedule
 * summaries and instructor names are all long enough to blow out a grid track
 * on a phone otherwise.
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  courseCard,
  courseCardHover,
  iconTints,
  type IconTint,
} from "./course-surface";

export function MetricCard({
  icon: Icon,
  label,
  value,
  tint = "brand",
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  tint?: IconTint;
}) {
  return (
    <div className={cn(courseCard, "min-w-0 p-[18px]")}>
      <div
        className={cn(
          "mb-3.5 flex h-[38px] w-[38px] items-center justify-center rounded-[10px]",
          iconTints[tint]
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <p className="text-[26px] leading-none font-bold tabular-nums">{value}</p>
      <p className="mt-[7px] truncate text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

const NAV_CARD = cn(
  courseCard,
  courseCardHover,
  "group block min-w-0 cursor-pointer p-[18px] text-left"
);

function CardBody({
  icon: Icon,
  title,
  detail,
}: {
  icon: React.ElementType;
  title: string;
  detail: string;
}) {
  return (
    <>
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "flex h-[38px] w-[38px] items-center justify-center rounded-[10px]",
            iconTints.brand
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <ChevronRight className="h-4 w-4 text-rose-300 transition-transform group-hover:translate-x-0.5 dark:text-rose-800" />
      </div>
      <p className="mt-3.5 text-sm font-semibold">{title}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
    </>
  );
}

/** Moves to another tab on the same page. */
export function NavCard({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(NAV_CARD, "w-full")}>
      <CardBody icon={icon} title={title} detail={detail} />
    </button>
  );
}

/** Leaves for another screen, deep-linked to this course. */
export function LinkCard({
  icon,
  title,
  detail,
  href,
}: {
  icon: React.ElementType;
  title: string;
  detail: string;
  href: string;
}) {
  return (
    <Link href={href} className={NAV_CARD}>
      <CardBody icon={icon} title={title} detail={detail} />
    </Link>
  );
}
