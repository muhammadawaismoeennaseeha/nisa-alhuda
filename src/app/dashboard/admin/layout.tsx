/**
 * Admin layout guard — admits admins (full access), instructors
 * (admin powers minus billing), and treasurers (payment ledger only).
 *
 * Path-aware routing keeps each role on the screens they're allowed
 * to see:
 *   • admin       → everything under /dashboard/admin/*
 *   • instructor  → everything EXCEPT /dashboard/admin/payments/*
 *   • treasurer   → ONLY /dashboard/admin/payments/*
 *
 * The middleware forwards `x-pathname`, so we can branch on the
 * current path before deciding to render or redirect.
 */
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export default async function AdminLayout({
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

  const role = profile?.role;
  const pathname =
    (await headers()).get("x-pathname") ||
    (await headers()).get("x-invoke-path") ||
    "";
  const onBillingRoute = pathname.startsWith("/dashboard/admin/payments");
  // /dashboard/admin/users hosts role-editing, password-set/reset, and
  // suspend/unsuspend. Letting an instructor in would let them grant
  // themselves the admin role, so this stays admin-only too.
  const onUsersRoute = pathname.startsWith("/dashboard/admin/users");
  // The audit log names people and describes money/role decisions.
  // Admin-only, same reasoning as the user directory.
  const onAuditRoute = pathname.startsWith("/dashboard/admin/audit-log");

  // Admins have full access.
  if (role === "admin") return <>{children}</>;

  // Instructors get every admin page EXCEPT billing and the user
  // directory (privilege-escalation surface).
  if (role === "instructor") {
    if (onBillingRoute || onUsersRoute || onAuditRoute) redirect("/dashboard");
    return <>{children}</>;
  }

  // Treasurers are payments-only. Bounce them onto the ledger from
  // anywhere else under /dashboard/admin/.
  if (role === "treasurer") {
    if (onBillingRoute) return <>{children}</>;
    redirect("/dashboard/admin/payments");
  }

  redirect("/dashboard");
}
