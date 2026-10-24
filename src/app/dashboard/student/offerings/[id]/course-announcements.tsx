"use client";

/**
 * CourseAnnouncements — read-only announcements view for enrolled students.
 *
 * Groups announcements by subject (pinned first within each group).
 * PDFs open in a new tab; images render inline. All attachment URLs
 * are short-lived signed URLs generated server-side.
 *
 * This component is purely presentational: it receives pre-fetched data
 * and never writes to the database.
 */

import { useState } from "react";
import {
  Megaphone,
  FileText,
  Image as ImageIcon,
  AlignLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { courseCard } from "@/components/course/course-surface";

export type StudentAnnouncementItem = {
  id: string;
  subjectId: string | null;
  subjectTitle: string;
  title: string;
  body: string;
  attachmentType: "text" | "pdf" | "image";
  attachmentName: string | null;
  signedUrl: string | null;
  isPinned: boolean;
  createdAt: string;
};

const TYPE_ICON = {
  text: AlignLeft,
  pdf: FileText,
  image: ImageIcon,
} as const;

const TYPE_LABEL = {
  text: "Announcement",
  pdf: "PDF",
  image: "Image",
} as const;

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CourseAnnouncements({
  items,
}: {
  items: StudentAnnouncementItem[];
}) {
  if (items.length === 0) {
    return (
      <div
        className={cn(
          courseCard,
          "flex flex-col items-center justify-center px-[18px] py-10 text-center"
        )}
      >
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[10px] bg-rose-50 text-rose-400 dark:bg-rose-950/30 dark:text-rose-300">
          <Megaphone className="h-[18px] w-[18px]" />
        </div>
        <p className="text-[13.5px] font-medium text-stone-700 dark:text-stone-300">
          No announcements yet
        </p>
        <p className="mt-1 text-[12.5px] text-stone-400 dark:text-stone-500">
          Your instructor will post exam dates, results, and updates here.
        </p>
      </div>
    );
  }

  // Group by subject title (preserving insertion order).
  const grouped: Map<string, StudentAnnouncementItem[]> = new Map();
  for (const item of items) {
    const key = item.subjectTitle;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  return (
    <div className="space-y-5">
      {Array.from(grouped.entries()).map(([subject, group]) => (
        <div key={subject} className="space-y-3">
          {grouped.size > 1 && (
            <h3 className="font-heading text-[13.5px] font-semibold text-stone-700 dark:text-stone-300">
              {subject}
            </h3>
          )}
          {group.map((item) => (
            <StudentAnnouncementCard key={item.id} item={item} />
          ))}
        </div>
      ))}
    </div>
  );
}

function StudentAnnouncementCard({ item }: { item: StudentAnnouncementItem }) {
  const [expanded, setExpanded] = useState(true);
  const Icon = TYPE_ICON[item.attachmentType];

  return (
    <div
      className={cn(
        courseCard,
        "overflow-hidden p-0",
        item.isPinned && "border-rose-200 dark:border-rose-900"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-[18px] py-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]",
              item.attachmentType === "text"
                ? "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                : item.attachmentType === "pdf"
                  ? "bg-rose-50 text-rose-500 dark:bg-rose-950/30 dark:text-rose-300"
                  : "bg-sky-50 text-sky-500 dark:bg-sky-950/30 dark:text-sky-300"
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-heading text-[13.5px] font-semibold text-stone-900 dark:text-stone-100">
                {item.title}
              </p>
              {item.isPinned && (
                <span className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-500 dark:bg-rose-950/30 dark:text-rose-300">
                  <Pin className="h-3 w-3" /> Pinned
                </span>
              )}
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                {TYPE_LABEL[item.attachmentType]}
              </span>
            </div>
            <p className="text-[12px] text-stone-400 dark:text-stone-500">
              {relativeTime(item.createdAt)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded-[6px] p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Body + attachment */}
      {expanded && (
        <div className="border-t border-stone-100 px-[18px] py-3.5 dark:border-stone-800">
          {item.body && (
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-stone-700 dark:text-stone-300">
              {item.body}
            </p>
          )}
          {item.attachmentType === "pdf" && item.signedUrl && (
            <a
              href={item.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-[8px] border border-stone-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-stone-700 transition-colors hover:border-rose-300 hover:text-rose-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-rose-700 dark:hover:text-rose-300"
            >
              <FileText className="h-3.5 w-3.5" />
              {item.attachmentName ?? "Open PDF"}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {item.attachmentType === "image" && item.signedUrl && (
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.signedUrl}
                alt={item.attachmentName ?? item.title}
                className="max-h-[360px] rounded-[10px] border border-stone-200 object-contain dark:border-stone-700"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
