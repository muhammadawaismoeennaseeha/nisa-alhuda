/**
 * Instructor Analytics — bento-box dashboard with key metrics.
 * Covers course completion, student activity, and engagement data.
 */
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  BarChart3,
  Users,
  BookOpen,
  Video,
  Clock,
  TrendingUp,
  Calendar,
  Award,
} from "lucide-react";

import { getDashboardViewer, applyTeachingScope } from "@/lib/auth-helpers";

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const viewer = await getDashboardViewer();
  if (!viewer) return null;

  // Admins see analytics across every instructor; instructors see only theirs.
  let subjectsQuery = supabase
    .from("subjects")
    .select("id, title, offering_id");
  subjectsQuery = applyTeachingScope(subjectsQuery, viewer);
  const { data: subjects } = await subjectsQuery;

  const subjectIds = subjects?.map((s) => s.id) || [];
  const offeringIds = [
    ...new Set((subjects || []).map((s) => s.offering_id)),
  ];

  // Fetch lessons
  const { data: lessons } = subjectIds.length > 0
    ? await supabase
        .from("lessons")
        .select("id, subject_id, is_published, scheduled_at, recording_url")
        .in("subject_id", subjectIds)
    : { data: [] };

  // Fetch enrollments for instructor's offerings
  const { data: enrollments, error: enrollError } = offeringIds.length > 0
    ? await supabase
        .from("enrollments")
        .select("id, student_id, status, created_at")
        .in("offering_id", offeringIds)
    : { data: [] as any[], error: null };

  if (enrollError) {
    console.error("Error fetching enrollments:", enrollError.message);
  }

  // ── Compute Metrics ──

  const totalLessons = lessons?.length || 0;
  const publishedLessons = lessons?.filter((l) => l.is_published).length || 0;
  const pendingRecordings =
    lessons?.filter(
      (l) =>
        l.scheduled_at &&
        new Date(l.scheduled_at) < new Date() &&
        !l.recording_url
    ).length || 0;
  const recordingsUploaded =
    lessons?.filter((l) => l.recording_url).length || 0;

  const totalStudents =
    new Set((enrollments || []).filter((e) => e.status === "approved").map((e) => e.student_id))
      .size;
  const pendingEnrollments =
    (enrollments || []).filter((e) => e.status === "pending").length;

  // Average Course Completion = published lessons / total lessons
  const avgCompletion =
    totalLessons > 0
      ? Math.round((publishedLessons / totalLessons) * 100)
      : 0;

  // Most Active Time of Day — based on enrollment creation timestamps
  const hourCounts: number[] = new Array(24).fill(0);
  (enrollments || []).forEach((e) => {
    const hour = new Date(e.created_at).getHours();
    hourCounts[hour]++;
  });

  const maxHourCount = Math.max(...hourCounts, 1);
  const peakHour = hourCounts.indexOf(maxHourCount);

  // Format hour as "9 AM", "2 PM" etc.
  function formatHour(h: number) {
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h > 12 ? `${h - 12} PM` : `${h} AM`;
  }

  // Group hours into time blocks for the activity chart
  const timeBlocks = [
    { label: "Morning", range: "6AM-12PM", hours: [6, 7, 8, 9, 10, 11] },
    { label: "Afternoon", range: "12PM-5PM", hours: [12, 13, 14, 15, 16] },
    { label: "Evening", range: "5PM-9PM", hours: [17, 18, 19, 20] },
    { label: "Night", range: "9PM-6AM", hours: [21, 22, 23, 0, 1, 2, 3, 4, 5] },
  ];

  const blockCounts = timeBlocks.map((block) => ({
    ...block,
    count: block.hours.reduce((sum, h) => sum + hourCounts[h], 0),
  }));

  const maxBlockCount = Math.max(...blockCounts.map((b) => b.count), 1);

  // Lessons per subject for distribution
  const lessonsPerSubject = (subjects || []).map((s) => ({
    name: s.title.split("—")[0]?.trim() || s.title,
    count: (lessons || []).filter((l) => l.subject_id === s.id).length,
  }));

  const maxSubjectLessons = Math.max(
    ...lessonsPerSubject.map((s) => s.count),
    1
  );

  return (
    <div>
      <PageHeader
        icon={BarChart3}
        title="Analytics"
        subtitle="Track your teaching metrics and student engagement at a glance."
      />

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* ── Total Students (1x1) ── */}
        <Card className="hover-lift">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground">
                Total Students
              </p>
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
            </div>
            <p className="text-4xl font-bold">{totalStudents}</p>
            {pendingEnrollments > 0 && (
              <p className="text-xs text-amber-600 mt-2">
                +{pendingEnrollments} pending approval
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Average Course Completion (1x1) ── */}
        <Card className="hover-lift">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground">
                Avg Course Completion
              </p>
              <div className="h-9 w-9 rounded-xl bg-green-50 dark:bg-green-950/20 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-green-600" />
              </div>
            </div>
            <div className="flex items-end gap-3">
              <p className="text-4xl font-bold">{avgCompletion}%</p>
              {/* Progress ring */}
              <div className="relative h-14 w-14 shrink-0">
                <svg className="h-14 w-14 -rotate-90" viewBox="0 0 56 56">
                  <circle
                    cx="28"
                    cy="28"
                    r="24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    className="text-muted/30"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r="24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${avgCompletion * 1.508} 150.8`}
                    className="text-green-500"
                  />
                </svg>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {publishedLessons} of {totalLessons} lessons published
            </p>
          </CardContent>
        </Card>

        {/* ── Published Lessons (1x1) ── */}
        <Card className="hover-lift">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground">
                Published Lessons
              </p>
              <div className="h-9 w-9 rounded-xl bg-blue-50 dark:bg-blue-950/20 flex items-center justify-center">
                <Video className="h-4 w-4 text-blue-600" />
              </div>
            </div>
            <p className="text-4xl font-bold">{publishedLessons}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {recordingsUploaded} with recordings &middot;{" "}
              {pendingRecordings > 0 ? (
                <span className="text-amber-600">
                  {pendingRecordings} pending upload
                </span>
              ) : (
                "all up to date"
              )}
            </p>
          </CardContent>
        </Card>

        {/* ── Most Active Time of Day (2x1) ── */}
        <Card className="md:col-span-2 hover-lift">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Most Active Time of Day
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Based on student enrollment activity
                </p>
              </div>
              <div className="h-9 w-9 rounded-xl bg-purple-50 dark:bg-purple-950/20 flex items-center justify-center">
                <Clock className="h-4 w-4 text-purple-600" />
              </div>
            </div>

            {(enrollments || []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No activity data yet. Metrics will appear once students enroll.
              </p>
            ) : (
              <>
                {/* Peak time badge */}
                <div className="flex items-center gap-2 mb-4">
                  <p className="text-2xl font-bold">{formatHour(peakHour)}</p>
                  <span className="text-xs text-muted-foreground">
                    peak activity
                  </span>
                </div>

                {/* Time block bars */}
                <div className="grid grid-cols-4 gap-3">
                  {blockCounts.map((block) => {
                    const pct = Math.round(
                      (block.count / maxBlockCount) * 100
                    );
                    return (
                      <div key={block.label} className="text-center">
                        <div className="h-20 flex items-end justify-center mb-2">
                          <div
                            className="w-full max-w-[40px] rounded-t-md bg-purple-200 dark:bg-purple-900/40 transition-all relative"
                            style={{ height: `${Math.max(pct, 8)}%` }}
                          >
                            {block.count > 0 && (
                              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-medium">
                                {block.count}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-xs font-medium">{block.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {block.range}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Active Subjects (1x1) ── */}
        <Card className="hover-lift">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground">
                Active Subjects
              </p>
              <div className="h-9 w-9 rounded-xl bg-amber-50 dark:bg-amber-950/20 flex items-center justify-center">
                <BookOpen className="h-4 w-4 text-amber-600" />
              </div>
            </div>
            <p className="text-4xl font-bold mb-3">
              {subjects?.length || 0}
            </p>

            {/* Mini bar chart of lessons per subject */}
            <div className="space-y-2">
              {lessonsPerSubject.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16 truncate shrink-0">
                    {s.name}
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{
                        width: `${(s.count / maxSubjectLessons) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs font-medium w-4 text-right">
                    {s.count}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Recordings Status (1x1) ── */}
        <Card className="hover-lift">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground">
                Recordings
              </p>
              <div className="h-9 w-9 rounded-xl bg-red-50 dark:bg-red-950/20 flex items-center justify-center">
                <Video className="h-4 w-4 text-red-500" />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Uploaded</span>
                <span className="text-sm font-bold text-green-600">
                  {recordingsUploaded}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Pending</span>
                <span className="text-sm font-bold text-amber-600">
                  {pendingRecordings}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Not Scheduled</span>
                <span className="text-sm font-bold text-muted-foreground">
                  {totalLessons - recordingsUploaded - pendingRecordings}
                </span>
              </div>

              {/* Stacked bar */}
              {totalLessons > 0 && (
                <div className="flex h-3 rounded-full overflow-hidden bg-muted mt-2">
                  <div
                    className="bg-green-500 transition-all"
                    style={{
                      width: `${(recordingsUploaded / totalLessons) * 100}%`,
                    }}
                  />
                  <div
                    className="bg-amber-400 transition-all"
                    style={{
                      width: `${(pendingRecordings / totalLessons) * 100}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Teaching Summary (1x1) ── */}
        <Card className="hover-lift">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground">
                Teaching Summary
              </p>
              <div className="h-9 w-9 rounded-xl bg-secondary flex items-center justify-center">
                <Award className="h-4 w-4 text-primary" />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">
                    Upcoming Sessions
                  </p>
                  <p className="text-sm font-semibold">
                    {
                      (lessons || []).filter(
                        (l) =>
                          l.scheduled_at &&
                          new Date(l.scheduled_at) > new Date()
                      ).length
                    }
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40">
                <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">
                    Total Content
                  </p>
                  <p className="text-sm font-semibold">
                    {subjects?.length || 0} subjects &middot; {totalLessons}{" "}
                    lessons
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40">
                <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">
                    Student Reach
                  </p>
                  <p className="text-sm font-semibold">
                    {totalStudents} enrolled
                    {pendingEnrollments > 0 &&
                      ` · ${pendingEnrollments} pending`}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
