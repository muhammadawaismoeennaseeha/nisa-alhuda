/**
 * Mobile Navigation — slide-out drawer for dashboard on small screens.
 * Shows all role-based nav items + user info + logout.
 */
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Menu,
  X,
  LogOut,
  LayoutDashboard,
  BookOpen,
  ClipboardList,
  GraduationCap,
  Users,
  Megaphone,
  Settings,
  Video,
  FileText,
  BarChart3,
  Mail,
  KeyRound,
  Table2,
  CalendarDays,
  Wallet,
} from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { createClient } from "@/lib/supabase/client";
import { roleLabel } from "@/lib/portal-roles";
import type { UserRole } from "@/lib/types/database";

// Map icon names to components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  BookOpen,
  ClipboardList,
  GraduationCap,
  Users,
  Megaphone,
  Settings,
  Video,
  FileText,
  BarChart3,
  Mail,
  KeyRound,
  Table2,
  CalendarDays,
  Wallet,
};

interface SerializedNavItem {
  href: string;
  label: string;
  iconName: string;
}

interface MobileNavProps {
  navItems: SerializedNavItem[];
  fullName: string;
  role: string;
}

export function MobileNav({ navItems, fullName, role }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Hamburger button */}
      <button
        onClick={() => setOpen(true)}
        className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Drawer is portaled to document.body so it isn't constrained by the
          parent <header>'s backdrop-blur containing block. */}
      {mounted &&
        createPortal(
          <>
            {open && (
              <div
                className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-md"
                onClick={() => setOpen(false)}
              />
            )}

            <div
              className={`fixed top-0 right-0 z-[70] flex h-full w-[85%] max-w-sm flex-col bg-white border-l border-border shadow-2xl transform transition-transform duration-300 ease-in-out ${
                open ? "translate-x-0" : "translate-x-full"
              }`}
            >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <Logo size="sm" />
          <button
            onClick={() => setOpen(false)}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 min-h-0 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = iconMap[item.iconName] || LayoutDashboard;
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User info + Logout */}
        <div className="shrink-0 p-4 border-t bg-white">
          <div className="mb-3 px-1">
            <p className="text-sm font-medium truncate">{fullName}</p>
            <p className="text-xs text-muted-foreground">{roleLabel(role as UserRole)}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Log Out
          </button>
        </div>
      </div>
          </>,
          document.body,
        )}
    </>
  );
}
