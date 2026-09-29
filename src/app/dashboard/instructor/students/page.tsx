/**
 * Student Management — shows enrolled sisters with engagement scores.
 * Engagement is calculated from enrollment tenure and activity signals.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  Users,
  User,
  Phone,
  Calendar,
  TrendingUp,
  Award,
  Sparkles,
  Clock,
  ScrollText,
  Wallet,
} from "lucide-react";
import { getDashboardViewer, applyTeachingScope } from "@/lib/auth-helpers";
import type { Profile } from "@/lib/types/database";

/**
 * Compute the activity tier from a sign-in timestamp.
 *  - Active: signed in within the last 24 hours.
 *  - Recent: within 7 days.
 *  - Dormant: longer than 7 days, or never signed in.
 */
function getActivityStatus(lastSignInAt: string | null | undefined) {
  if (!lastSignInAt) {
    return {
      label: "Never signed in",
      tone: "text-muted-foreground",
      dot: "bg-muted-foreground/40",
      relative: "—",
    };
  }
  const now = Date.now();
  const last = new Date(lastSignInAt).getTime();
  const diffMs = Math.max(0, now - last);
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  let relative: string;
  if (diffMin < 2) relative = "just now";
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffHr < 24) relative = `${diffHr}h ago`;
  else if (diffDay < 30) relative = `${diffDay}d ago`;
  else relative = `${Math.floor(diffDay / 30)}mo ago`;

  if (diffHr < 24)
    return { label: "Active", tone: "text-emerald-600", dot: "bg-emerald-500", relative };
  if (diffDay <= 7)
    return { label: "Recent", tone: "text-amber-600", dot: "bg-amber-500", relative };
  return { label: "Dormant", tone: "text-muted-foreground", dot: "bg-muted-foreground/40", relative };
}

// Engagement tiers
function getEngagementTier(score: number) {
  if (score >= 80)
    return { label: "Highly Active", color: "text-green-600", bg: "bg-green-100 dark:bg-green-950/30" };
  if (score >= 60)
    return { label: "Active", color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-950/30" };
  if (score >= 40)
    return { label: "Moderate", color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-950/30" };
  return { label: "New", color: "text-gray-500", bg: "bg-gray-100 dark:bg-gray-800/30" };
}

export default async function StudentManagementPage() {
  const supabase = await createClient();
  const viewer = await getDashboardViewer();
  if (!viewer) return null;

  // Admins see every instructor's students; instructors see only their own.
  let subjectsQuery = supabase
    .from("subjects")
    .select("id, title, offering_id");
  subjectsQuery = applyTeachingScope(subjectsQuery, viewer);
  const { data: subjects } = await subjectsQuery;

  if (!subjects || subjects.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-2">Students</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Enrolled sisters and their engagement.
        </p>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
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

  // Get unique offering IDs. Filter out nulls — possible when admins view
  // every subject in the system and some are unassigned to an offering.
  const offeringIds = [
    ...new Set(
      subjects
        .map((s) => s.offering_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  // If there are no offerings, skip the enrollments fetch entirely —
  // .in("offering_id", []) would return zero rows but it's noisier.
  let enrollments: any[] = [];
  if (offeringIds.length > 0) {
    const { data, error: enrollError } = await supabase
      .from("enrollments")
      .select(
        "*, student:profiles!enrollments_student_id_fkey(*), offering:offerings!enrollments_offering_id_fkey(id, title)"
      )
      .in("offering_id", offeringIds)
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    if (enrollError) {
      console.error("[students] enrollments fetch failed:", enrollError.message);
    }
    enrollments = data || [];
  }

  // Fetch last_sign_in_at for each student via the admin client. The
  // auth.users table isn't exposed through the regular API, so we go
  // through service-role admin.listUsers() and build a lookup map.
  // Listing all users is fine here — production cohorts are <500 — but
  // if this grows large we'd switch to per-id fetches in parallel.
  const studentIds = new Set(enrollments.map((e: any) => e.student_id));
  const lastSignInById: Record<string, string | null> = {};
  try {
    const admin = createAdminClient();
    const { data: authList } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    for (const u of authList?.users ?? []) {
      if (studentIds.has(u.id)) {
        lastSignInById[u.id] = u.last_sign_in_at ?? null;
      }
    }
  } catch (e) {
    console.error("[students] could not fetch last_sign_in_at:", e);
  }

  // Build student data with engagement scores
  const now = new Date();

  // Count enrollments per student (across all offerings) for multi-enrollment bonus
  const enrollmentCountByStudent: Record<string, number> = {};
  enrollments.forEach((e: any) => {
    const sid = e.student_id;
    enrollmentCountByStudent[sid] = (enrollmentCountByStudent[sid] || 0) + 1;
  });

  // Deduplicate students (a student may be enrolled in multiple offerings)
  const seenStudents = new Set<string>();
  const students = enrollments
    .filter((e: any) => {
      // Skip rows where the embedded student profile is null (RLS could
      // hide it, or the row is orphaned). Without this, the .map below
      // would crash trying to read fields of null.
      if (!e.student) return false;
      if (seenStudents.has(e.student_id)) return false;
      seenStudents.add(e.student_id);
      return true;
    })
    .map((enrollment: any) => {
      const student = enrollment.student as Profile;
      const enrolledAt = new Date(enrollment.created_at);
      const tenureDays = Math.floor(
        (now.getTime() - enrolledAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Engagement Score (0-100)
      // Base: 40 (approved enrollment)
      // Tenure: up to 30 (scaled over 90 days)
      // Profile: +10 if phone, +10 if multiple enrollments
      // Activity proxy: +10 if enrolled early (within first 7 days of offering)
      const tenureBonus = Math.min(30, Math.round((tenureDays / 90) * 30));
      const phoneBonus = student.phone ? 10 : 0;
      const multiBonus =
        (enrollmentCountByStudent[enrollment.student_id] || 1) > 1 ? 10 : 0;
      const earlyBonus = tenureDays > 7 ? 10 : 5;

      const score = Math.min(
        100,
        40 + tenureBonus + phoneBonus + multiBonus + earlyBonus
      );

      return {
        id: student.id,
        name: student.full_name,
        phone: student.phone,
        enrolledAt: enrollment.created_at,
        offeringTitle: enrollment.offering?.title,
        enrollmentCount: enrollmentCountByStudent[enrollment.student_id] || 1,
        tenureDays,
        score,
        lastSignInAt: lastSignInById[enrollment.student_id] ?? null,
      };
    })
    .sort((a: any, b: any) => b.score - a.score);

  // Stats
  const avgScore =
    students.length > 0
      ? Math.round(
          students.reduce((sum: number, s: any) => sum + s.score, 0) /
            students.length
        )
      : 0;

  const highlyActive = students.filter((s: any) => s.score >= 80).length;

  // Count students who signed in within the last 24 hours.
  const activeNow = students.filter((s: any) => {
    if (!s.lastSignInAt) return false;
    return Date.now() - new Date(s.lastSignInAt).getTime() < 24 * 60 * 60 * 1000;
  }).length;

  return (
    <div>
      <PageHeader
        icon={Users}
        title="Students"
        subtitle="Enrolled sisters in your subjects, with their engagement scores."
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{students.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="relative h-10 w-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 flex items-center justify-center">
              <Clock className="h-5 w-5 text-emerald-600" />
              <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeNow}</p>
              <p className="text-xs text-muted-foreground">Active 24h</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-green-50 dark:bg-green-950/20 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{avgScore}%</p>
              <p className="text-xs text-muted-foreground">Avg Engagement</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-50 dark:bg-amber-950/20 flex items-center justify-center">
              <Award className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{highlyActive}</p>
              <p className="text-xs text-muted-foreground">Highly Active</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Student list */}
      {students.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-lg mb-2">
              No enrolled students yet
            </p>
            <p className="text-sm text-muted-foreground">
              Students will appear here once their enrollment is approved.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {students.map((student: any) => {
            const tier = getEngagementTier(student.score);
            const activity = getActivityStatus(student.lastSignInAt);
            return (
              <Card key={student.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Avatar with activity dot */}
                    <div className="relative h-11 w-11 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <User className="h-5 w-5 text-primary" />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-background ${activity.dot}`}
                        title={`${activity.label} · last seen ${activity.relative}`}
                      />
                    </div>

                    {/* Student info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">
                          {student.name}
                        </h3>
                        <Badge
                          variant="outline"
                          className={`text-xs ${activity.tone}`}
                        >
                          {activity.label}
                        </Badge>
                        <Badge variant="outline" className={`text-xs ${tier.color}`}>
                          {tier.label}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span
                          className={`flex items-center gap-1 ${activity.tone}`}
                        >
                          <Clock className="h-3 w-3" />
                          Last seen {activity.relative}
                        </span>
                        {student.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {student.phone}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Enrolled{" "}
                          {new Date(student.enrolledAt).toLocaleDateString(
                            "en-PK",
                            { day: "numeric", month: "short", year: "numeric" }
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          {student.offeringTitle}
                        </span>
                      </div>
                    </div>

                    {/* Engagement score */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className={`h-3.5 w-3.5 ${tier.color}`} />
                          <span className="text-lg font-bold">
                            {student.score}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Engagement
                        </p>
                      </div>
                      {/* Score bar */}
                      <div className="w-20 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            student.score >= 80
                              ? "bg-green-500"
                              : student.score >= 60
                                ? "bg-blue-500"
                                : student.score >= 40
                                  ? "bg-amber-500"
                                  : "bg-gray-400"
                          }`}
                          style={{ width: `${student.score}%` }}
                        />
                      </div>
                      {/* Transcript (registrar) and Fees (financial) are not
                          part of a Teaching Assistant's scope — hide the links
                          so a TA is never sent to a page that turns them away. */}
                      {viewer.role !== "ta" && (
                        <>
                          <Link
                            href={`/dashboard/instructor/students/${student.id}/transcript`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                          >
                            <ScrollText className="h-3.5 w-3.5" />
                            Transcript
                          </Link>
                          <Link
                            href={`/dashboard/instructor/students/${student.id}/fees`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                          >
                            <Wallet className="h-3.5 w-3.5" />
                            Fees
                          </Link>
                        </>
                      )}
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
