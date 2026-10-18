/**
 * User Directory — searchable list of all users with admin actions.
 * Features: search, role filter, login-as-user, ban/suspend.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROFILE_SELECT_ADMIN } from "@/lib/db/profiles";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { UserDirectory } from "./user-directory";
import type { Profile } from "@/lib/types/database";

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: adminProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id)
    .single();

  if (adminProfile?.role !== "admin") {
    return (
      <div className="text-center py-20">
        <p className="text-destructive font-medium">Access denied.</p>
      </div>
    );
  }

  // Fetch all profiles. Service-role client, deliberately: the lock_override
  // columns are not readable by `authenticated` (migration 046) and this
  // directory shows them. The admin-role check above is the gate.
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select(PROFILE_SELECT_ADMIN)
    .order("created_at", { ascending: false });

  // Get enrollment counts per student
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("student_id, status");

  const enrollmentCounts: Record<string, { total: number; approved: number }> = {};
  (enrollments || []).forEach((e: any) => {
    if (!enrollmentCounts[e.student_id]) {
      enrollmentCounts[e.student_id] = { total: 0, approved: 0 };
    }
    enrollmentCounts[e.student_id].total++;
    if (e.status === "approved") enrollmentCounts[e.student_id].approved++;
  });

  const roleStats = {
    admin: (profiles || []).filter((p: any) => p.role === "admin").length,
    treasurer: (profiles || []).filter((p: any) => p.role === "treasurer").length,
    instructor: (profiles || []).filter((p: any) => p.role === "instructor").length,
    student: (profiles || []).filter((p: any) => p.role === "student").length,
  };

  return (
    <div>
      <PageHeader
        icon={Users}
        title="User Directory"
        subtitle="Search, filter, and manage all students and teachers."
      />

      {/* Role stats */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Badge variant="outline" className="text-sm py-1 px-3">
          {(profiles || []).length} total users
        </Badge>
        <Badge variant="default" className="text-sm py-1 px-3">
          {roleStats.student} students
        </Badge>
        <Badge variant="outline" className="text-sm py-1 px-3 text-blue-600 border-blue-300">
          {roleStats.instructor} instructors
        </Badge>
        <Badge variant="outline" className="text-sm py-1 px-3 text-amber-600 border-amber-300">
          {roleStats.treasurer} treasurers
        </Badge>
        <Badge variant="outline" className="text-sm py-1 px-3 text-purple-600 border-purple-300">
          {roleStats.admin} admins
        </Badge>
      </div>

      <UserDirectory
        profiles={(profiles as Profile[]) || []}
        enrollmentCounts={enrollmentCounts}
        currentUserId={user?.id || ""}
      />
    </div>
  );
}
