/**
 * Dashboard layout — shared wrapper for all authenticated dashboard pages.
 * Premium sidebar (grouped, active indicator) + polished mobile header.
 *
 * Course content is always open — there is no fee-based content gate.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/layout/logo";
import type { Profile } from "@/lib/types/database";
import { DashboardLogout } from "./logout-button";
import { NotificationBell } from "./notification-bell";
import { MobileNav } from "./mobile-nav";
import { SidebarNav, type NavSection } from "./sidebar-nav";
import { StudentBottomNav } from "./student-bottom-nav";
import { roleLabel } from "@/lib/portal-roles";

export default async function DashboardLayout({
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
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) redirect("/login");

  // Security gate: suspended accounts cannot access any dashboard route.
  if (profile.is_suspended) redirect("/suspended");

  // Security gate: force password change before accessing any dashboard page.
  // /dashboard/settings is allowed through so the user can actually change it.
  if (profile.must_change_password) {
    const currentPath = (await headers()).get("x-pathname") ?? "";
    if (!currentPath.startsWith("/dashboard/settings")) {
      redirect("/dashboard/settings");
    }
  }

  const sections = getNavSections(profile.role);

  // Flatten for the mobile nav (keeps its simpler flat list).
  const flatNavItems = sections.flatMap((s) => s.items);

  const initials = (profile.full_name || "")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-muted/20">
      {/* Desktop Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex items-center justify-between border-b px-4 py-4">
          <Logo size="sm" />
          <NotificationBell userId={profile.id} />
        </div>

        <SidebarNav sections={sections} />

        {/* User card */}
        <div className="border-t p-3">
          <div className="mb-2 flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {initials || "✦"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{profile.full_name}</p>
              <p className="text-[11px] text-muted-foreground">
                {roleLabel(profile.role)}
              </p>
            </div>
          </div>
          <DashboardLogout />
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <MobileNav
              navItems={flatNavItems}
              fullName={profile.full_name}
              role={profile.role}
            />
            <Logo size="sm" />
          </div>
          <NotificationBell userId={profile.id} />
        </header>

        <main className="flex-1 px-4 py-5 md:px-8 md:py-7 pb-24 md:pb-7">
          <div className="mx-auto w-full max-w-6xl">
            {children}
          </div>
        </main>

        {profile.role === "student" && <StudentBottomNav />}
      </div>
    </div>
  );
}

function getNavSections(role: string): NavSection[] {
  const home = {
    items: [
      { href: "/dashboard", label: "Home", iconName: "LayoutDashboard" },
    ],
  };

  if (role === "admin") {
    return [
      home,
      {
        label: "Manage",
        items: [
          {
            href: "/dashboard/admin/offerings",
            label: "Courses",
            iconName: "BookOpen",
          },
          {
            href: "/dashboard/admin/enrollments",
            label: "Enrollments",
            iconName: "GraduationCap",
          },
          {
            href: "/dashboard/admin/users",
            label: "Users",
            iconName: "Users",
          },
          {
            href: "/dashboard/admin/audit-log",
            label: "Audit log",
            iconName: "ScrollText",
          },
        ],
      },
      // Admins get the full instructor toolset too — same screens, but
      // unrestricted scope (every instructor's subjects, classes,
      // resources). RLS already permits admins on all underlying tables.
      // Resources live inside each Subject folder now, so the standalone
      // Resources link is gone — instructors and admins go through
      // Subjects → click a subject → manage classes + resources inline.
      {
        label: "Teaching (all instructors)",
        items: [
          {
            href: "/dashboard/instructor",
            label: "Subjects",
            iconName: "BookOpen",
          },
          {
            href: "/dashboard/instructor/live",
            label: "Live Hub",
            iconName: "Video",
          },
          {
            href: "/dashboard/instructor/students",
            label: "Students",
            iconName: "Users",
          },
          {
            href: "/dashboard/instructor/analytics",
            label: "Analytics",
            iconName: "BarChart3",
          },
          {
            href: "/dashboard/admin/calendar",
            label: "Calendar",
            iconName: "CalendarDays",
          },
        ],
      },
      {
        label: "Communication",
        items: [
          {
            href: "/dashboard/announcements",
            label: "Announcements",
            iconName: "Megaphone",
          },
          {
            href: "/dashboard/admin/emails",
            label: "Emails",
            iconName: "Mail",
          },
          {
            href: "/dashboard/admin/credentials",
            label: "Credentials",
            iconName: "KeyRound",
          },
        ],
      },
      {
        label: "Account",
        items: [
          {
            href: "/dashboard/settings",
            label: "Settings",
            iconName: "Settings",
          },
        ],
      },
    ];
  }

  if (role === "treasurer") {
    return [
      home,
      {
        label: "Account",
        items: [
          {
            href: "/dashboard/settings",
            label: "Settings",
            iconName: "Settings",
          },
        ],
      },
    ];
  }

  if (role === "instructor") {
    // Instructors mirror the admin nav — same management screens,
    // same teaching toolset — EXCEPT for the two billing routes
    // (Payments + Billing Grid) and the User Directory. The user
    // directory hosts role-editing + password resets, so leaving it in
    // would let instructors elevate themselves to admin.
    return [
      home,
      {
        label: "Manage",
        items: [
          {
            href: "/dashboard/admin/offerings",
            label: "Courses",
            iconName: "BookOpen",
          },
          {
            href: "/dashboard/admin/enrollments",
            label: "Enrollments",
            iconName: "GraduationCap",
          },
        ],
      },
      {
        label: "Teaching",
        items: [
          {
            href: "/dashboard/instructor",
            label: "Subjects",
            iconName: "BookOpen",
          },
          {
            href: "/dashboard/instructor/live",
            label: "Live Hub",
            iconName: "Video",
          },
          {
            href: "/dashboard/instructor/students",
            label: "Students",
            iconName: "Users",
          },
          {
            href: "/dashboard/instructor/analytics",
            label: "Analytics",
            iconName: "BarChart3",
          },
          {
            href: "/dashboard/admin/calendar",
            label: "Calendar",
            iconName: "CalendarDays",
          },
        ],
      },
      {
        label: "Communication",
        items: [
          {
            href: "/dashboard/announcements",
            label: "Announcements",
            iconName: "Megaphone",
          },
          {
            href: "/dashboard/admin/emails",
            label: "Emails",
            iconName: "Mail",
          },
          {
            href: "/dashboard/admin/credentials",
            label: "Credentials",
            iconName: "KeyRound",
          },
        ],
      },
      {
        label: "Account",
        items: [
          {
            href: "/dashboard/settings",
            label: "Settings",
            iconName: "Settings",
          },
        ],
      },
    ];
  }

  if (role === "ta") {
    // Teaching Assistants are scoped instructors. They live in the instructor
    // area (Subjects, Live Hub, Students, Analytics — all narrowed to their
    // assigned courses by `applyTeachingScope`), plus the shared Announcements
    // and their own Settings. Deliberately NO admin-area links: the admin
    // layout doesn't admit a TA, and none of those screens (Courses,
    // Enrollments, Payments, Users, Calendar) are theirs — so every link here
    // is one a TA can actually open, and no financial surface appears at all.
    return [
      home,
      {
        label: "Teaching",
        items: [
          {
            href: "/dashboard/instructor",
            label: "Subjects",
            iconName: "BookOpen",
          },
          {
            href: "/dashboard/instructor/live",
            label: "Live Hub",
            iconName: "Video",
          },
          {
            href: "/dashboard/instructor/students",
            label: "Students",
            iconName: "Users",
          },
          {
            href: "/dashboard/instructor/analytics",
            label: "Analytics",
            iconName: "BarChart3",
          },
        ],
      },
      {
        label: "Community",
        items: [
          {
            href: "/dashboard/announcements",
            label: "Announcements",
            iconName: "Megaphone",
          },
        ],
      },
      {
        label: "Account",
        items: [
          {
            href: "/dashboard/settings",
            label: "Settings",
            iconName: "Settings",
          },
        ],
      },
    ];
  }

  // Student (default)
  return [
    home,
    {
      label: "Learning",
      items: [
        {
          href: "/dashboard/student",
          label: "My Learning",
          iconName: "GraduationCap",
        },
        {
          href: "/dashboard/student/schedule",
          label: "Schedule",
          iconName: "CalendarDays",
        },
        {
          href: "/dashboard/student/live",
          label: "Live Sessions",
          iconName: "Video",
        },
        {
          href: "/dashboard/student/enrollments",
          label: "Enrollments",
          iconName: "ClipboardList",
        },
        {
          href: "/dashboard/student/transcript",
          label: "Transcript",
          iconName: "ScrollText",
        },
      ],
    },
    {
      label: "Community",
      items: [
        {
          href: "/dashboard/announcements",
          label: "Announcements",
          iconName: "Megaphone",
        },
      ],
    },
    {
      label: "Account",
      items: [
        {
          href: "/dashboard/settings",
          label: "Settings",
          iconName: "Settings",
        },
      ],
    },
  ];
}
