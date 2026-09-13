/**
 * Helpers for the per-subject recurring class schedule introduced in
 * migration 024.
 *
 * Subjects can carry: recurring_day_of_week (0=Sun..6=Sat),
 * recurring_start_time ("HH:MM:SS" local), recurring_duration_minutes,
 * and recurring_meeting_url. We treat the time as **Pakistan Standard
 * Time (Asia/Karachi, UTC+5)** because that's the audience and PK does
 * not observe DST — so a fixed-offset shortcut is correct year-round.
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

export interface RecurringScheduleInput {
  recurring_day_of_week: number | null;
  recurring_start_time: string | null;
  recurring_duration_minutes: number | null;
  recurring_meeting_url: string | null;
  recurring_schedule_label: string | null;
}

/**
 * Convert a UTC ISO timestamp to the `YYYY-MM-DDTHH:MM` string an
 * `<input type="datetime-local">` wants, expressed in PKT wall-clock.
 *
 * Reads the shifted instant through `getUTC*` so the result is the same
 * whatever timezone the admin's laptop is set to.
 */
export function utcIsoToPktInput(iso: string): string {
  const pkt = new Date(new Date(iso).getTime() + PKT_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pkt.getUTCFullYear()}-${pad(pkt.getUTCMonth() + 1)}-${pad(pkt.getUTCDate())}T${pad(pkt.getUTCHours())}:${pad(pkt.getUTCMinutes())}`;
}

/**
 * The inverse: treat a `datetime-local` value as PKT wall-clock and return
 * the UTC ISO string to store. Built from `Date.UTC`, so it never consults
 * the host timezone.
 */
export function pktInputToUtcIso(local: string): string {
  const [datePart, timePart] = local.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = (timePart ?? "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - PKT_OFFSET_MS).toISOString();
}

/**
 * Returns true if every required field for a "real" recurring schedule
 * is set. The label is optional — the UI falls back to a computed label
 * when missing.
 */
export function hasRecurringSchedule(
  s: RecurringScheduleInput | null | undefined
): boolean {
  if (!s) return false;
  return (
    s.recurring_meeting_url != null &&
    s.recurring_meeting_url.trim() !== "" &&
    s.recurring_day_of_week != null &&
    s.recurring_start_time != null
  );
}

/**
 * Compute the start/end Date of the NEXT (or currently in-progress)
 * occurrence of a recurring class. Returns null when the schedule is
 * incomplete. The returned Date objects are absolute (UTC) — consumers
 * can `.toLocaleString("en-PK", { timeZone: "Asia/Karachi" })` for
 * display.
 */
export function computeNextOccurrence(
  s: RecurringScheduleInput,
  now: Date = new Date()
): { start: Date; end: Date } | null {
  if (!hasRecurringSchedule(s)) return null;
  const targetDay = s.recurring_day_of_week!;
  const time = parseHHMMSS(s.recurring_start_time!);
  if (!time) return null;
  const duration = (s.recurring_duration_minutes ?? 60) * 60 * 1000;

  // Convert "now" to PKT wall-clock by adding the offset and reading
  // the resulting UTC parts as if they were local PKT.
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const pktDay = pkt.getUTCDay();
  const pktHours = pkt.getUTCHours();
  const pktMinutes = pkt.getUTCMinutes();
  const pktSeconds = pkt.getUTCSeconds();

  // Minutes since midnight (PKT) of the target start.
  const targetMinutes = time.h * 60 + time.m;
  const nowMinutes = pktHours * 60 + pktMinutes + pktSeconds / 60;

  let dayDiff = (targetDay - pktDay + 7) % 7;
  // If today is the day-of-week and start time hasn't passed by more
  // than `duration`, treat THIS occurrence as the "next" one (so a class
  // that started 30 min ago still shows as "live now").
  if (dayDiff === 0 && nowMinutes > targetMinutes + (duration / 60000)) {
    dayDiff = 7;
  }

  // Build the start in PKT wall-clock, then convert back to UTC.
  const startPktMs =
    Date.UTC(
      pkt.getUTCFullYear(),
      pkt.getUTCMonth(),
      pkt.getUTCDate(),
      time.h,
      time.m,
      time.s
    ) +
    dayDiff * ONE_DAY_MS;
  const startUtcMs = startPktMs - PKT_OFFSET_MS;

  return {
    start: new Date(startUtcMs),
    end: new Date(startUtcMs + duration),
  };
}

/**
 * "live now" if the current moment is between start and end of the
 * computed occurrence. computeNextOccurrence may return a future window
 * — we re-check the start carefully: if start is in the past AND end is
 * in the future, it's live.
 */
export function isLiveNow(
  s: RecurringScheduleInput,
  now: Date = new Date()
): boolean {
  const occ = computeNextOccurrence(s, now);
  if (!occ) return false;
  return now >= occ.start && now <= occ.end;
}

/**
 * True when both `scheduledAt` and `now` fall on the same calendar day
 * in Pakistan Standard Time. Used to hide Join buttons for sessions
 * that are not happening today (e.g. tomorrow's Fiqh class shouldn't
 * be joinable from the dashboard while it's still Wednesday).
 */
export function isSameDayPkt(
  scheduledAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!scheduledAt) return false;
  const s = typeof scheduledAt === "string" ? new Date(scheduledAt) : scheduledAt;
  if (Number.isNaN(s.getTime())) return false;
  const sPkt = new Date(s.getTime() + PKT_OFFSET_MS);
  const nPkt = new Date(now.getTime() + PKT_OFFSET_MS);
  return sPkt.toISOString().slice(0, 10) === nPkt.toISOString().slice(0, 10);
}

/**
 * For a SUBJECT's recurring schedule: true when the configured weekly
 * day matches today's day-of-week in PKT. Lets the per-subject "Live
 * class" card hide its Join button on non-class days.
 */
export function isClassDayPkt(
  s: RecurringScheduleInput | null | undefined,
  now: Date = new Date()
): boolean {
  if (!s || s.recurring_day_of_week == null) return false;
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  return pkt.getUTCDay() === s.recurring_day_of_week;
}

/**
 * Falls back to a computed "Mondays 6:00 PM PKT (60 min)" style label
 * when admin didn't set one explicitly.
 */
export function scheduleDisplayLabel(s: RecurringScheduleInput): string | null {
  if (s.recurring_schedule_label && s.recurring_schedule_label.trim()) {
    return s.recurring_schedule_label;
  }
  if (!hasRecurringSchedule(s)) return null;
  const dayName = DAY_NAMES[s.recurring_day_of_week!];
  const time = parseHHMMSS(s.recurring_start_time!);
  if (!time) return null;
  const display12 = formatTime12(time.h, time.m);
  return `${dayName}s ${display12} PKT`;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function parseHHMMSS(value: string): { h: number; m: number; s: number } | null {
  const parts = value.split(":").map((p) => parseInt(p, 10));
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  return { h: parts[0], m: parts[1], s: parts[2] ?? 0 };
}

function formatTime12(h: number, m: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(m).padStart(2, "0");
  return `${h12}:${mm} ${period}`;
}
