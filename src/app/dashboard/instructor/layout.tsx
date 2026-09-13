/**
 * Instructor layout guard — ensures only instructors (or admins) can access /dashboard/instructor/* pages.
 */
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isTeachingStaff } from "@/lib/portal-roles";

export default async function InstructorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Instructors, admins, and Teaching Assistants share this area. A TA is
  // scoped to their assigned courses at the data layer (see applyTeachingScope
  // and the course-scoped server-action gates); the layout only decides who
  // may enter the door.
  if (profile?.role !== "admin" && !isTeachingStaff(profile?.role)) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
