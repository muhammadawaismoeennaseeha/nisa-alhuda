/**
 * Admin / instructor Calendar — an institute-wide month view of every
 * scheduled class, across all offerings the role may see.
 *
 * Same two data sources as the student WeeklyCalendar, minus the
 * per-student enrollment filter:
 *   1. Recurring weekly classes — subjects.recurring_* (shown every week).
 *   2. Ad-hoc dated sessions — lessons.scheduled_at (shown on their date).
 *
 * Read-only. recording_url is only read (to badge "recording available")
 * and never written. RLS decides which offerings each role can see.
 */
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MonthCalendar } from "@/components/schedule/month-calendar";
import type { RecurringEvent, AdhocEvent } from "@/components/schedule/weekly-calendar";

export default async function AdminCalendarPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Offerings this role may see (RLS scopes the result).
  const { data: offeringsRaw } = await supabase
    .from("offerings")
    .select("id, title")
    .order("title", { ascending: true });

  const offeringTitleMap: Record<string, string> = {};
  const colorMap: Record<string, number> = {};
  (offeringsRaw ?? []).forEach((o, i) => {
    offeringTitleMap[o.id] = o.title;
    colorMap[o.id] = i;
  });
  const offeringIds = Object.keys(offeringTitleMap);

  const recurringEvents: RecurringEvent[] = [];
  const adhocEvents: AdhocEvent[] = [];

  if (offeringIds.length > 0) {
    // Recurring weekly classes
    const { data: subjectsRaw } = await supabase
      .from("subjects")
      .select(
        "id, title, offering_id, recurring_day_of_week, recurring_start_time, recurring_duration_minutes, recurring_meeting_url"
      )
      .in("offering_id", offeringIds)
      .not("recurring_meeting_url", "is", null)
      .not("recurring_day_of_week", "is", null)
      .not("recurring_start_time", "is", null);

    for (const s of subjectsRaw ?? []) {
      if (
        s.recurring_day_of_week === null ||
        !s.recurring_start_time ||
        !s.recurring_meeting_url
      )
        continue;

      const [startHour, startMinute] = (s.recurring_start_time as string)
        .split(":")
        .map(Number);

      recurringEvents.push({
        id: s.id,
        offeringId: s.offering_id,
        offeringTitle: offeringTitleMap[s.offering_id] ?? "",
        subjectTitle: s.title,
        dayOfWeek: s.recurring_day_of_week as number,
        startHour,
        startMinute,
        durationMinutes: (s.recurring_duration_minutes as number | null) ?? 60,
        meetingUrl: s.recurring_meeting_url as string,
        colorIndex: colorMap[s.offering_id] ?? 0,
      });
    }

    // Ad-hoc dated sessions (window: ~2 months back -> ~4 months ahead).
    // This is an async server component: it runs once per request, so reading
    // the wall clock here is correct and stable for this render. The
    // react-hooks/purity rule assumes client re-render, which never happens here.
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now();
    const windowStart = new Date(nowMs - 60 * 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(nowMs + 120 * 24 * 60 * 60 * 1000).toISOString();

    const { data: lessonsRaw } = await supabase
      .from("lessons")
      .select(
        "id, title, offering_id, scheduled_at, live_class_link, recording_url, subjects(title)"
      )
      .in("offering_id", offeringIds)
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", windowStart)
      .lte("scheduled_at", windowEnd)
      .eq("is_published", true)
      .order("scheduled_at", { ascending: true });

    for (const lesson of lessonsRaw ?? []) {
      if (!lesson.scheduled_at) continue;
      const subjectTitle =
        (lesson.subjects as unknown as { title: string } | null)?.title ??
        (lesson.title as string);

      adhocEvents.push({
        id: lesson.id,
        offeringId: lesson.offering_id,
        offeringTitle: offeringTitleMap[lesson.offering_id] ?? "",
        subjectTitle,
        scheduledAtUtc: lesson.scheduled_at as string,
        durationMinutes: 60,
        liveClassLink: (lesson.live_class_link as string | null) ?? null,
        recordingUrl: (lesson.recording_url as string | null) ?? null,
        colorIndex: colorMap[lesson.offering_id] ?? 0,
      });
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <CalendarDays className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Every scheduled class across all courses &mdash; recurring weekly
            classes and dated sessions. Times shown in PKT.
          </p>
        </div>
      </div>

      <MonthCalendar recurringEvents={recurringEvents} adhocEvents={adhocEvents} />
    </div>
  );
}
