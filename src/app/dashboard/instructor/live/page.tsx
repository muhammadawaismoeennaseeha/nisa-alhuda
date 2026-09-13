/**
 * Live Hub — cross-cutting "what's happening today/soon" view across
 * every subject. Source of truth is `lessons` (a class = a lesson row);
 * the legacy `live_sessions` table is no longer written or read here.
 *
 * What you see:
 *   - Top stats: live now, today, this week, recordings pending
 *   - Live now / Upcoming today list with Join buttons
 *   - Pending recordings list with inline URL updater
 *
 * Class scheduling itself lives inside each subject folder
 * (/dashboard/instructor/subjects/[id]).
 */
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  Video,
  Clock,
  AlertCircle,
  CheckCircle,
  Radio,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { RecordingUpdater } from "./recording-updater";
import { getDashboardViewer, applyTeachingScope } from "@/lib/auth-helpers";
import type { Lesson } from "@/lib/types/database";

export default async function LiveHubPage() {
  const supabase = await createClient();
  const viewer = await getDashboardViewer();
  if (!viewer) return null;

  // Admins see every instructor's subjects; instructors see only their own.
  let subjectsQuery = supabase
    .from("subjects")
    .select("id, title, offering_id, instructor_id");
  subjectsQuery = applyTeachingScope(subjectsQuery, viewer);
  const { data: subjects } = await subjectsQuery;

  if (!subjects || subjects.length === 0) {
    return (
      <div>
        <PageHeader
          icon={Video}
          title="Live Hub"
          subtitle={
            viewer.isAdmin
              ? "What's live now and what's coming up — across every subject."
              : "What's live now and what's coming up — across all your subjects."
          }
        />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Video className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-lg">
              {viewer.isAdmin
                ? "No subjects in the system yet"
                : "No subjects assigned yet"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const subjectIds = subjects.map((s) => s.id);
  const subjectMap = Object.fromEntries(
    subjects.map((s) => [s.id, s.title])
  );

  // Pull every class for the in-scope subjects. We compute "live / upcoming /
  // pending recording" buckets in JS — small dataset, simpler than SQL.
  const { data: lessonsData } = await supabase
    .from("lessons")
    .select("*, subject:subjects(recurring_meeting_url)")
    .in("subject_id", subjectIds)
    .order("scheduled_at", { ascending: true });

  // Pulls in the subject's recurring_meeting_url so the Join button can
  // fall back to it when a lesson has no per-row live_class_link (the
  // new pattern: one URL per subject, lessons pre-created without links).
  type LessonWithSubject = Lesson & {
    subject?: { recurring_meeting_url: string | null } | null;
  };
  const lessons: LessonWithSubject[] = (lessonsData as LessonWithSubject[]) || [];
  const now = Date.now();
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;

  const liveNow = lessons.filter((l) => {
    if (!l.scheduled_at || l.recording_url) return false;
    const start = new Date(l.scheduled_at).getTime();
    return now >= start && now <= start + TWO_HOURS;
  });

  const upcomingToday = lessons.filter((l) => {
    if (!l.scheduled_at) return false;
    const start = new Date(l.scheduled_at).getTime();
    return start > now && start - now <= ONE_DAY;
  });

  const upcomingThisWeek = lessons.filter((l) => {
    if (!l.scheduled_at) return false;
    const start = new Date(l.scheduled_at).getTime();
    return start > now && start - now <= ONE_WEEK;
  });

  const pendingRecordings = lessons.filter(
    (l) =>
      l.scheduled_at &&
      new Date(l.scheduled_at).getTime() < now - TWO_HOURS &&
      !l.recording_url
  );

  const recordedCount = lessons.filter((l) => Boolean(l.recording_url)).length;

  return (
    <div>
      <PageHeader
        icon={Video}
        title="Live Hub"
        subtitle={
          viewer.isAdmin
            ? "What's live now and what's coming up — across every subject."
            : "What's live now and what's coming up — across all your subjects. Schedule classes inside each subject folder."
        }
      />

      {/* Top stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="relative h-10 w-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 flex items-center justify-center shrink-0">
              <Radio className="h-5 w-5 text-emerald-600" />
              {liveNow.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background animate-pulse" />
              )}
            </div>
            <div>
              <p className="text-2xl font-bold">{liveNow.length}</p>
              <p className="text-xs text-muted-foreground">Live now</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-950/20 flex items-center justify-center shrink-0">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{upcomingToday.length}</p>
              <p className="text-xs text-muted-foreground">Today</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-50 dark:bg-amber-950/20 flex items-center justify-center shrink-0">
              <AlertCircle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{pendingRecordings.length}</p>
              <p className="text-xs text-muted-foreground">Pending rec.</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-green-50 dark:bg-green-950/20 flex items-center justify-center shrink-0">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{recordedCount}</p>
              <p className="text-xs text-muted-foreground">Recordings</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live now */}
      {liveNow.length > 0 && (
        <section className="mb-8">
          <h2 className="font-heading font-semibold text-lg mb-3 flex items-center gap-2">
            <Radio className="h-5 w-5 text-emerald-600" />
            Live now
            <Badge
              variant="outline"
              className="text-emerald-600 border-emerald-300"
            >
              {liveNow.length}
            </Badge>
          </h2>
          <div className="space-y-3">
            {liveNow.map((lesson) => (
              <ClassRow
                key={lesson.id}
                lesson={lesson}
                subjectTitle={subjectMap[lesson.subject_id || ""] || "Subject"}
                tone="live"
              />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming today */}
      <section className="mb-8">
        <h2 className="font-heading font-semibold text-lg mb-3 flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-600" />
          Upcoming today
          {upcomingToday.length > 0 && (
            <Badge variant="outline" className="text-blue-600 border-blue-300">
              {upcomingToday.length}
            </Badge>
          )}
        </h2>
        {upcomingToday.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No classes scheduled in the next 24 hours.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {upcomingToday.map((lesson) => (
              <ClassRow
                key={lesson.id}
                lesson={lesson}
                subjectTitle={subjectMap[lesson.subject_id || ""] || "Subject"}
                tone="upcoming"
              />
            ))}
          </div>
        )}
      </section>

      {/* This week (excluding today) */}
      {upcomingThisWeek.length > upcomingToday.length && (
        <section className="mb-8">
          <h2 className="font-heading font-semibold text-lg mb-3">
            Later this week
          </h2>
          <div className="space-y-3">
            {upcomingThisWeek
              .filter((l) => !upcomingToday.includes(l))
              .map((lesson) => (
                <ClassRow
                  key={lesson.id}
                  lesson={lesson}
                  subjectTitle={subjectMap[lesson.subject_id || ""] || "Subject"}
                  tone="later"
                />
              ))}
          </div>
        </section>
      )}

      {/* Pending recordings */}
      <section>
        <h2 className="font-heading font-semibold text-lg mb-3 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          Pending recording uploads
          {pendingRecordings.length > 0 && (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              {pendingRecordings.length}
            </Badge>
          )}
        </h2>
        {pendingRecordings.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              All recordings are up to date. Great job!
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pendingRecordings.map((lesson) => (
              <Card
                key={lesson.id}
                className="border-amber-200 dark:border-amber-800"
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-xl bg-amber-50 dark:bg-amber-950/20 flex items-center justify-center shrink-0">
                        <AlertCircle className="h-5 w-5 text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold">{lesson.title}</h3>
                        <p className="text-xs text-muted-foreground">
                          {subjectMap[lesson.subject_id || ""] || "Subject"}{" "}
                          &middot; Held on{" "}
                          {new Date(lesson.scheduled_at!).toLocaleString(
                            "en-PK",
                            {
                              timeZone: "Asia/Karachi",
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            }
                          )}
                        </p>
                      </div>
                      {lesson.subject_id && (
                        <Link
                          href={`/dashboard/instructor/subjects/${lesson.subject_id}`}
                          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 shrink-0"
                        >
                          Open subject
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                    <RecordingUpdater lessonId={lesson.id} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Class row used for live / upcoming sections ───────────

function ClassRow({
  lesson,
  subjectTitle,
  tone,
}: {
  lesson: Lesson & {
    subject?: { recurring_meeting_url: string | null } | null;
  };
  subjectTitle: string;
  tone: "live" | "upcoming" | "later";
}) {
  const start = lesson.scheduled_at ? new Date(lesson.scheduled_at) : null;
  const joinUrl =
    lesson.live_class_link ?? lesson.subject?.recurring_meeting_url ?? null;
  const ringTone =
    tone === "live"
      ? "border-emerald-300 bg-emerald-50/30"
      : tone === "upcoming"
        ? "border-blue-200 bg-blue-50/20"
        : "";
  return (
    <Card className={ringTone}>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-primary font-medium mb-0.5">
              {subjectTitle}
            </p>
            <h3 className="font-semibold truncate">{lesson.title}</h3>
            {start && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {start.toLocaleString("en-PK", {
                  timeZone: "Asia/Karachi",
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                PKT
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {lesson.subject_id && (
              <Link
                href={`/dashboard/instructor/subjects/${lesson.subject_id}`}
                className="inline-flex items-center gap-1 rounded-full border bg-background hover:bg-muted text-xs font-medium px-3 py-1.5 transition-colors"
              >
                Manage
              </Link>
            )}
            {joinUrl && (
              <a
                href={joinUrl}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center gap-1.5 rounded-full text-xs font-medium px-3 py-1.5 transition-colors ${
                  tone === "live"
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-primary hover:bg-primary/90 text-primary-foreground"
                }`}
              >
                {tone === "live" ? (
                  <Radio className="h-3.5 w-3.5" />
                ) : (
                  <Video className="h-3.5 w-3.5" />
                )}
                Join
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
