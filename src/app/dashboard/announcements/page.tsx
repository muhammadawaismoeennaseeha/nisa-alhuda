/**
 * Announcements Page — shared across all roles.
 * Admins/instructors see a "New Announcement" button and can manage posts.
 * Students see a read-only feed of announcements relevant to them.
 */
import { createClient } from "@/lib/supabase/server";
import { PROFILE_SELECT } from "@/lib/db/profiles";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Pin } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { AnnouncementManager } from "./announcement-manager";
import type { Profile, Offering } from "@/lib/types/database";

export default async function AnnouncementsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) return null;

  const isAdmin = profile.role === "admin";
  const isInstructor = profile.role === "instructor";
  const canManage = isAdmin || isInstructor;

  // Fetch all announcements with author info
  const { data: announcements } = await supabase
    .from("announcements")
    .select("*, author:profiles!announcements_author_id_fkey(*), offering:offerings(*)")
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  // For students, filter to relevant announcements
  let visibleAnnouncements = announcements || [];

  if (profile.role === "student") {
    // Get student's enrolled offering IDs
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("offering_id")
      .eq("student_id", user.id)
      .eq("status", "approved");

    const enrolledIds = new Set(
      (enrollments || []).map((e: any) => e.offering_id)
    );

    visibleAnnouncements = visibleAnnouncements.filter(
      (a: any) => a.offering_id === null || enrolledIds.has(a.offering_id)
    );
  }

  // For instructor, get their offerings (for scoped announcements)
  let instructorOfferings: { id: string; title: string }[] = [];
  if (isInstructor) {
    const { data: subjects } = await supabase
      .from("subjects")
      .select("offering_id, offering:offerings(id, title)")
      .eq("instructor_id", user.id);

    const seen = new Set<string>();
    (subjects || []).forEach((s: any) => {
      if (s.offering && !seen.has(s.offering.id)) {
        seen.add(s.offering.id);
        instructorOfferings.push({
          id: s.offering.id,
          title: s.offering.title,
        });
      }
    });
  }

  // For admin, get all offerings
  let allOfferings: { id: string; title: string }[] = [];
  if (isAdmin) {
    const { data: offerings } = await supabase
      .from("offerings")
      .select("id, title")
      .in("status", ["published", "draft"])
      .order("title");
    allOfferings = (offerings || []).map((o: any) => ({
      id: o.id,
      title: o.title,
    }));
  }

  const availableOfferings = isAdmin ? allOfferings : instructorOfferings;

  return (
    <div>
      <PageHeader
        icon={Megaphone}
        title="Announcements"
        subtitle={
          canManage
            ? "Post announcements to all students or specific courses."
            : "Stay updated with the latest announcements from your instructors."
        }
      />

      {/* Manager component handles create/edit/delete for admins/instructors, read-only for students */}
      <AnnouncementManager
        announcements={visibleAnnouncements}
        offerings={availableOfferings}
        canManage={canManage}
        currentUserId={user.id}
        isAdmin={isAdmin}
      />
    </div>
  );
}
