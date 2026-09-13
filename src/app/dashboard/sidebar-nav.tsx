/**
 * Client-side sidebar nav with active-route indicator + section grouping.
 * Server layout passes serialized nav items (icon as string name) so we
 * can use usePathname() without pushing the whole layout to the client.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
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
  ScrollText,
  Wallet,
} from "lucide-react";

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
  ScrollText,
  Wallet,
};

export interface NavSection {
  label?: string;
  items: { href: string; label: string; iconName: string }[];
}

export function SidebarNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section, sIdx) => (
        <div key={sIdx}>
          {section.label && (
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              {section.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = iconMap[item.iconName] || LayoutDashboard;
              const active = isActive(item.href);
              return (
                <li key={item.href} className="relative">
                  {active && (
                    <span
                      className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-primary"
                      aria-hidden
                    />
                  )}
                  <Link
                    href={item.href}
                    className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 transition-transform ${
                        active
                          ? ""
                          : "text-muted-foreground/80 group-hover:text-foreground"
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
