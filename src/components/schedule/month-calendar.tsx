/**
 * MonthCalendar — an institute-wide month grid over the same two data
 * sources the WeeklyCalendar already uses:
 *   1. Recurring weekly classes (subjects.recurring_*), placed on every
 *      matching weekday of the visible month.
 *   2. Ad-hoc class sessions (lessons.scheduled_at), placed on their date.
 *
 * Read-only: chips link out to a meeting URL, live link, or the stored
 * recording URL when present — nothing here ever writes recording_url or
 * any other field. All times are PKT (UTC+5, no DST), matching WeeklyCalendar.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Video, PlayCircle } from "lucide-react";
import type { RecurringEvent, AdhocEvent } from "./weekly-calendar";

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5, no DST
const DAY_MS = 24 * 60 * 60 * 1000;

/** Add PKT offset so getUTC* reads return PKT wall-clock values. */
function toPkt(utcMs: number): Date {
  return new Date(utcMs + PKT_OFFSET_MS);
}

const CHIP_COLORS = [
  "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200",
  "bg-pink-100 text-pink-800 dark:bg-pink-950/50 dark:text-pink-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200",
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = minute.toString().padStart(2, "0");
  return `${h12}:${mm} ${period}`;
}

/** A single placed occurrence inside one day cell. */
interface DayItem {
  key: string;
  title: string;
  offeringTitle: string;
  timeLabel: string;
  sortMinutes: number;
  colorIndex: number;
  link: string | null;
  isRecording: boolean;
}

export function MonthCalendar({
  recurringEvents,
  adhocEvents,
}: {
  recurringEvents: RecurringEvent[];
  adhocEvents: AdhocEvent[];
}) {
  const [monthOffset, setMonthOffset] = useState(0);

  // "Now" in PKT — reading getUTC* gives PKT calendar values.
  const nowPkt = toPkt(Date.now());
  const baseYear = nowPkt.getUTCFullYear();
  const baseMonth = nowPkt.getUTCMonth();

  // Target month (PKT). Date.UTC(y, m + offset, 1) normalises year rollover.
  const firstOfMonth = new Date(Date.UTC(baseYear, baseMonth + monthOffset, 1));
  const viewYear = firstOfMonth.getUTCFullYear();
  const viewMonth = firstOfMonth.getUTCMonth();

  // Grid starts on the Monday on/before the 1st.
  const firstWeekday = (firstOfMonth.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const gridStartMs = firstOfMonth.getTime() - firstWeekday * DAY_MS;

  // Pre-index adhoc events by PKT y-m-d for O(1) cell lookup.
  const adhocByDate = new Map<string, AdhocEvent[]>();
  for (const e of adhocEvents) {
    const pkt = toPkt(new Date(e.scheduledAtUtc).getTime());
    const k = `${pkt.getUTCFullYear()}-${pkt.getUTCMonth()}-${pkt.getUTCDate()}`;
    (adhocByDate.get(k) ?? adhocByDate.set(k, []).get(k)!).push(e);
  }

  const todayKey = `${nowPkt.getUTCFullYear()}-${nowPkt.getUTCMonth()}-${nowPkt.getUTCDate()}`;

  const cells = Array.from({ length: 42 }, (_, i) => {
    const cellMs = gridStartMs + i * DAY_MS;
    const cell = new Date(cellMs);
    const cy = cell.getUTCFullYear();
    const cm = cell.getUTCMonth();
    const cd = cell.getUTCDate();
    const cdow = cell.getUTCDay(); // 0=Sun … 6=Sat
    const inMonth = cm === viewMonth && cy === viewYear;
    const key = `${cy}-${cm}-${cd}`;

    const items: DayItem[] = [];

    // Recurring classes land on every matching weekday.
    for (const e of recurringEvents) {
      if (e.dayOfWeek !== cdow) continue;
      items.push({
        key: `r-${e.id}-${key}`,
        title: e.subjectTitle,
        offeringTitle: e.offeringTitle,
        timeLabel: fmtTime(e.startHour, e.startMinute),
        sortMinutes: e.startHour * 60 + e.startMinute,
        colorIndex: e.colorIndex,
        link: e.meetingUrl,
        isRecording: false,
      });
    }

    // Ad-hoc sessions land on their exact PKT date.
    for (const e of adhocByDate.get(key) ?? []) {
      const pkt = toPkt(new Date(e.scheduledAtUtc).getTime());
      const h = pkt.getUTCHours();
      const m = pkt.getUTCMinutes();
      items.push({
        key: `a-${e.id}`,
        title: e.subjectTitle,
        offeringTitle: e.offeringTitle,
        timeLabel: fmtTime(h, m),
        sortMinutes: h * 60 + m,
        colorIndex: e.colorIndex,
        link: e.liveClassLink ?? e.recordingUrl,
        isRecording: !e.liveClassLink && !!e.recordingUrl,
      });
    }

    items.sort((a, b) => a.sortMinutes - b.sortMinutes);
    return { key, cd, inMonth, isToday: key === todayKey, items };
  });

  const hasAnything = recurringEvents.length > 0 || adhocEvents.length > 0;

  return (
    <div className="rounded-2xl border bg-card">
      {/* Month header + nav */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-base font-semibold">
          {MONTHS[viewMonth]} {viewYear}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonthOffset((o) => o - 1)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonthOffset(0)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setMonthOffset((o) => o + 1)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!hasAnything ? (
        <div className="px-6 py-16 text-center text-sm text-muted-foreground">
          No classes are scheduled yet. Recurring class schedules and dated
          sessions will appear here once they&rsquo;re set.
        </div>
      ) : (
        <>
          {/* Weekday header */}
          <div className="grid grid-cols-7 border-b text-center">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {cells.map((cell, i) => (
              <div
                key={cell.key}
                className={`min-h-[104px] border-b border-r p-1.5 last:border-r-0 ${
                  i % 7 === 6 ? "border-r-0" : ""
                } ${cell.inMonth ? "" : "bg-muted/30"}`}
              >
                <div
                  className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    cell.isToday
                      ? "bg-primary font-semibold text-primary-foreground"
                      : cell.inMonth
                        ? "text-foreground"
                        : "text-muted-foreground/50"
                  }`}
                >
                  {cell.cd}
                </div>
                <div className="space-y-1">
                  {cell.items.map((it) => {
                    const chip = (
                      <div
                        className={`truncate rounded-md px-1.5 py-1 text-[10px] font-medium leading-tight ${
                          CHIP_COLORS[it.colorIndex % CHIP_COLORS.length]
                        }`}
                        title={`${it.title} — ${it.offeringTitle} · ${it.timeLabel} PKT`}
                      >
                        <span className="flex items-center gap-1">
                          {it.link &&
                            (it.isRecording ? (
                              <PlayCircle className="h-2.5 w-2.5 shrink-0" />
                            ) : (
                              <Video className="h-2.5 w-2.5 shrink-0" />
                            ))}
                          <span className="truncate">{it.timeLabel}</span>
                        </span>
                        <span className="truncate block">{it.title}</span>
                      </div>
                    );
                    return it.link ? (
                      <Link
                        key={it.key}
                        href={it.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block hover:opacity-80"
                      >
                        {chip}
                      </Link>
                    ) : (
                      <div key={it.key}>{chip}</div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
