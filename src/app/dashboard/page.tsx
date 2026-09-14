/**
 * Dashboard index — redirects user to their role-specific dashboard.
 * This is a Server Component that checks the user's role and redirects.
 */
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Get the user's role from profiles
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Redirect to role-specific dashboard
  switch (profile?.role) {
    case "admin":
      redirect("/dashboard/admin");
    case "treasurer":
      // The payments UI has been removed; the treasurer role has no
      // dedicated screens, so land it on Settings (its only nav item).
      redirect("/dashboard/settings");
    case "instructor":
      redirect("/dashboard/instructor");
    case "ta":
      // Teaching Assistants live in the instructor area, narrowed to their
      // assigned courses at the data layer.
      redirect("/dashboard/instructor");
    default:
      redirect("/dashboard/student");
  }
}
