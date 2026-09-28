"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, BarChart3, Cog, Contact, LayoutGrid, Menu, MessageSquare, Package, QrCode, ScrollText, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  board: LayoutGrid,
  scanner: QrCode,
  customers: Contact,
  reports: BarChart3,
  parts: Package,
  staff: Users,
  refunds: Wallet,
  unclaimed: Archive,
  messages: MessageSquare,
  audit: ScrollText,
  settings: Cog,
  menu: Menu,
};
export type NavKey = keyof typeof ICONS;
export type NavItem = { key: NavKey; href: string; label: string };

function isActive(pathname: string, href: string) {
  if (href === "/bench") return pathname === "/bench" || pathname.startsWith("/bench/jobs");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Top-bar links (tablet/desktop). Icons are resolved here because server components can't pass component functions to the client. */
export function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="ml-4 hidden items-center gap-1 overflow-x-auto md:flex">
      {items.map((n) => {
        const on = isActive(pathname, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap",
              on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone tab bar: the three daily screens plus Menu, which lists everything else. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      aria-label="Main"
    >
      {items.map((n) => {
        const Icon = ICONS[n.key];
        const on = isActive(pathname, n.href) || (n.key === "menu" && (pathname.startsWith("/admin") || pathname === "/bench/menu"));
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on ? "page" : undefined}
            className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", on ? "font-semibold text-primary" : "text-muted-foreground")}
          >
            <Icon className="size-5" />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MenuGrid({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((n) => {
        const Icon = ICONS[n.key];
        const on = isActive(pathname, n.href);
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              className={cn(
                "flex min-h-20 flex-col items-start justify-between gap-2 rounded-xl border bg-card p-4 text-sm font-medium",
                on && "border-primary",
              )}
            >
              <Icon className="size-5 text-primary" />
              {n.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
