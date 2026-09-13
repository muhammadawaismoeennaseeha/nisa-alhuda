/**
 * Instructor Dashboard — shows assigned subjects across all offerings,
 * framed by a warm greeting + compact stats strip.
 */
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import {
  BookOpen,
  ArrowRight,
  Video,
  Users,
  GraduationCap,
  FileText,
} from "lucide-react";
import { DashboardGreeting } from "@/components/dashboard/greeting";
import { StatCard } from "@/components/dashboard/stat-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getDashboardViewer, applyTeachingScope } from "@/lib/auth-helpers";

export default async function InstructorDashboardPage() {
  const supabase = await createClient();
  const viewer = await getDashboardViewer();
  if (!viewer) return null;

  // Admins see every instructor's subjects; instructors see only their own.
  // RLS already permits admins on every table referenced below — this filter
  // only affects what the application chooses to query.
  let subjectsQuery = supabase
    .from("subjects")
    .select("*, offering:offerings(id, title, slug, status, type), instructor:profiles!subjects_instructor_id_fkey(id, full_name)")
    .order("sort_order", { ascending: true });

  subjectsQuery = applyTeachingScope(subjectsQuery, viewer);

  const { data: subjects, error } = await subjectsQuery;

  if (error) {
    console.error("Error fetching subjects:", error);
  }

  // Count lessons + student enrollments per offering in parallel
  const subjectIds = subjects?.map((s) => s.id) || [];
  const offeringIds = Array.from(
    new Set(
      (subjects || [])
        .map((s: { offering: { id: string } | null }) => s.offering?.id)
        .filter((id): id is string => Boolean(id))
    )
  );

  let lessonCounts: Record<string, number> = {};
  let totalLessons = 0;
  let totalStudents = 0;

  if (subjectIds.length > 0) {
    const [lessonsRes, enrollmentsRes] = await Promise.all([
      supabase.from("lessons").select("subject_id").in("subject_id", subjectIds),
      offeringIds.length > 0
        ? supabase
            .from("enrollments")
            .select("id", { count: "exact", head: true })
            .in("offering_id", offeringIds)
            .eq("status", "approved")
        : Promise.resolve({ count: 0 }),
    ]);

    if (lessonsRes.data) {
      lessonCounts = lessonsRes.data.reduce(
        (acc, l) => {
          if (l.subject_id) acc[l.subject_id] = (acc[l.subject_id] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      totalLessons = lessonsRes.data.length;
    }

    totalStudents = enrollmentsRes.count ?? 0;
  }

  const statusConfig = {
    draft: { label: "Draft", variant: "outline" as const },
    published: { label: "Published", variant: "default" as const },
    archived: { label: "Archived", variant: "secondary" as const },
  };

  const tail = viewer.isAdmin
    ? `Viewing every instructor's subjects (${subjects?.length ?? 0} total).`
    : subjects && subjects.length > 0
      ? `You're teaching ${subjects.length} subject${subjects.length > 1 ? "s" : ""} — may Allah reward your effort.`
      : "No subjects assigned yet — an admin will link you to one soon.";

  return (
    <div>
      <DashboardGreeting
        name={viewer.fullName || "Ustadha"}
        role={viewer.role}
        tail={tail}
      />

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Subjects"
          value={subjects?.length ?? 0}
          hint="assigned to you"
          icon={BookOpen}
        />
        <StatCard
          label="Lessons"
          value={totalLessons}
          hint="across all subjects"
          icon={FileText}
          accent="text-indigo-600"
        />
        <StatCard
          label="Students"
          value={totalStudents}
          hint="currently enrolled"
          icon={Users}
          accent="text-emerald-600"
        />
        <StatCard
          label="Offerings"
          value={offeringIds.length}
          hint="you contribute to"
          icon={GraduationCap}
          accent="text-amber-600"
        />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">My subjects</h2>
        {subjects && subjects.length > 0 && (
          <LinkButton
            variant="ghost"
            size="sm"
            href="/dashboard/instructor/live"
            className="text-xs"
          >
            Open Live Hub
            <ArrowRight className="ml-1 h-3 w-3" />
          </LinkButton>
        )}
      </div>

      {!subjects || subjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No subjects assigned yet"
          description="You'll see your subjects here once an admin assigns them to you. Reach out if something looks off."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {subjects.map(
            (subject: {
              id: string;
              title: string;
              description?: string | null;
              offering?: {
                id: string;
                title: string;
                status: string;
              } | null;
              instructor?: { id: string; full_name: string } | null;
            }) => {
              const offering = subject.offering;
              const offeringStatus =
                statusConfig[offering?.status as keyof typeof statusConfig] ||
                statusConfig.draft;
              const count = lessonCounts[subject.id] || 0;

              return (
                <Card
                  key={subject.id}
                  className="group overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <CardContent className="p-5">
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15 transition-transform group-hover:scale-105">
                        <BookOpen className="h-5 w-5 text-primary" />
                      </div>
                      <Badge variant={offeringStatus.variant}>
                        {offeringStatus.label}
                      </Badge>
                    </div>

                    <h3 className="mb-1 font-heading text-lg font-semibold leading-tight">
                      {subject.title}
                    </h3>
                    <p className="mb-1 text-sm font-medium text-primary/90">
                      {offering?.title}
                    </p>
                    {viewer.isAdmin && subject.instructor && (
                      <p className="mb-2 text-xs text-muted-foreground">
                        Instructor:{" "}
                        <span className="font-medium text-foreground">
                          {subject.instructor.full_name}
                        </span>
                      </p>
                    )}

                    {subject.description && (
                      <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
                        {subject.description}
                      </p>
                    )}

                    <div className="mt-4 flex items-center justify-between border-t pt-3">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Video className="h-4 w-4" />
                        <span>
                          {count} {count === 1 ? "lesson" : "lessons"}
                        </span>
                      </div>
                      <LinkButton
                        size="sm"
                        className="rounded-full"
                        href={`/dashboard/instructor/subjects/${subject.id}`}
                      >
                        Manage
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </LinkButton>
                    </div>
                  </CardContent>
                </Card>
              );
            }
          )}
        </div>
      )}
    </div>
  );
}
