"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ChartColumn,
  Home,
  Newspaper,
  NotebookText,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
}

const TABS: readonly Tab[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/chart", label: "Chart", icon: ChartColumn },
  { href: "/news", label: "News", icon: Newspaper },
  { href: "/journal", label: "Journal", icon: NotebookText },
];

/** Routes that render without the bottom tab bar. */
const HIDDEN_ON: readonly string[] = ["/sign-in", "/not-allowed"];

function isActive(tabHref: string, pathname: string | null): boolean {
  if (pathname === null) return false;
  if (tabHref === "/") return pathname === "/";
  return pathname === tabHref || pathname.startsWith(`${tabHref}/`);
}

function TabBarNav({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-nav pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex h-(--tab-bar-height) max-w-[480px]">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted transition-colors",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                active && "text-accent",
              )}
            >
              <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function TabBarForPath() {
  const pathname = usePathname();
  if (HIDDEN_ON.includes(pathname)) return null;
  return <TabBarNav pathname={pathname} />;
}

/**
 * Fixed bottom tab bar. Wrapped in Suspense because `usePathname` suspends
 * during prerender on routes with runtime params (e.g. /alerts/[id]); the
 * fallback is the same bar with no tab highlighted.
 */
export function TabBar() {
  return (
    <Suspense fallback={<TabBarNav pathname={null} />}>
      <TabBarForPath />
    </Suspense>
  );
}
