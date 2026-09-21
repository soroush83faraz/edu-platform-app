"use client";

import { Bell, BookOpen, Ellipsis, House, Inbox, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { CountBadge } from "@/components/CountBadge";
import { formatNumberFa } from "@/lib/format";
import { useInboxSummaryContext } from "./InboxSummaryProvider";
import type { InboxSummaryState } from "./useInboxSummary";

interface Item {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  badge?: (s: InboxSummaryState) => number;
}

const ITEMS: Item[] = [
  { href: "/home", label: "خانه", icon: House },
  { href: "/inbox", label: "پنل من", icon: Inbox, badge: (s) => s.unread },
  { href: "/notifications", label: "اعلان‌ها", icon: Bell, badge: (s) => s.unreadNotifications },
  { href: "/more", label: "بیشتر", icon: Ellipsis },
];

/**
 * The one navigation component: bottom bar on phones, start-side rail from `md:`. Both renderings read the shell's
 * single summary poller (`InboxSummaryProvider`), as do the Home strip and tile badges.
 */
export function AppNav({ schoolName, showAdmin = false }: { schoolName: string; showAdmin?: boolean }) {
  const pathname = usePathname();
  const summary = useInboxSummaryContext();
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // The bottom bar has ONE pill that slides between the four cells; off-tab routes (/admin, /change-password) hide it.
  const activeIndex = ITEMS.findIndex((item) => isCurrent(item.href));
  // «مدیریت» only on the desktop rail (the bottom bar keeps its four fixed items; phones reach it via «بیشتر»).
  const sideItems: Item[] = showAdmin ? [...ITEMS.slice(0, 3), { href: "/admin", label: "مدیریت", icon: Settings2 }, ITEMS[3]] : ITEMS;

  return (
    <>
      <nav aria-label="پیمایش اصلی" className="fixed inset-x-0 bottom-0 z-20 border-t border-line/70 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden">
        <ul className="relative grid grid-cols-4">
          <li
            aria-hidden
            className="pointer-events-none absolute top-1.5 flex h-7 w-1/4 justify-center transition-[inset-inline-start,opacity] duration-(--duration-base) ease-(--ease-in-out)"
            style={{ insetInlineStart: `${Math.max(activeIndex, 0) * 25}%`, opacity: activeIndex < 0 ? 0 : 1 }}
          >
            <span className="h-7 w-12 rounded-full bg-info-soft" />
          </li>
          {ITEMS.map((item) => (
            <NavLink key={item.href} item={item} current={isCurrent(item.href)} count={item.badge?.(summary) ?? 0} layout="bottom" />
          ))}
        </ul>
      </nav>
      <aside className="hidden w-60 shrink-0 flex-col border-e border-line bg-surface md:sticky md:top-0 md:flex md:h-screen">
        <div className="flex h-16 items-center gap-3 px-5">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-xl bg-hero text-white shadow-1">
            <BookOpen className="size-4" />
          </span>
          <span className="truncate text-base font-semibold text-text">{schoolName}</span>
        </div>
        <nav aria-label="پیمایش اصلی" className="flex-1 px-3 py-2">
          <ul className="flex flex-col gap-1">
            {sideItems.map((item) => (
              <NavLink key={item.href} item={item} current={isCurrent(item.href)} count={item.badge?.(summary) ?? 0} layout="side" />
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}

function NavLink({ item, current, count, layout }: { item: Item; current: boolean; count: number; layout: "bottom" | "side" }) {
  const Icon = item.icon;
  const badge = <CountBadge count={count} label={`${formatNumberFa(count)} مورد خوانده‌نشده`} floating={layout === "bottom"} />;

  if (layout === "bottom") {
    return (
      <li>
        <Link
          href={item.href}
          aria-current={current ? "page" : undefined}
          className={cn(
            "group pressable relative flex min-h-14 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-xs",
            current ? "font-semibold text-primary-700" : "text-text-muted hover:text-text",
          )}
        >
          {/* The sliding pill lives on the <ul>; this span only positions the icon and badge, and darkens on press. */}
          <span className={cn("relative flex h-7 w-12 items-center justify-center rounded-full transition-base", !current && "group-active:bg-surface-sunken")}>
            <Icon className={cn("size-5 transition-base", current && "text-primary-700")} aria-hidden />
            {badge}
          </span>
          {item.label}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={item.href}
        aria-current={current ? "page" : undefined}
        className={cn(
          "pressable flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm",
          current ? "bg-info-soft font-semibold text-primary-800" : "text-text-muted hover:bg-surface-sunken hover:text-text",
        )}
      >
        <Icon className={cn("size-5", current ? "text-primary-700" : "text-text-faint")} aria-hidden />
        <span className="flex-1">{item.label}</span>
        {badge}
      </Link>
    </li>
  );
}
