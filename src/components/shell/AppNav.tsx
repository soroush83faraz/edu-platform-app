"use client";

import { Bell, Ellipsis, House, Inbox, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { formatNumberFa } from "@/lib/format";
import { type InboxSummaryState, useInboxSummary } from "./useInboxSummary";

interface Item {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  badge?: (s: InboxSummaryState) => number;
}

const ITEMS: Item[] = [
  { href: "/home", label: "خانه", icon: House },
  { href: "/inbox", label: "کارتابل", icon: Inbox, badge: (s) => s.unread },
  { href: "/notifications", label: "اعلان‌ها", icon: Bell, badge: (s) => s.unreadNotifications },
  { href: "/more", label: "بیشتر", icon: Ellipsis },
];

/**
 * The one navigation component: bottom bar on phones, start-side rail from `md:`. Holds the single summary
 * poller so both renderings share the same badge numbers.
 */
export function AppNav({ initial, schoolName, showAdmin = false }: { initial: InboxSummaryState; schoolName: string; showAdmin?: boolean }) {
  const pathname = usePathname();
  const summary = useInboxSummary(initial);
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // «مدیریت» only on the desktop rail (the bottom bar keeps its four fixed items; phones reach it via «بیشتر»).
  const sideItems: Item[] = showAdmin ? [...ITEMS.slice(0, 3), { href: "/admin", label: "مدیریت", icon: Settings2 }, ITEMS[3]] : ITEMS;

  return (
    <>
      <nav aria-label="پیمایش اصلی" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-4">
          {ITEMS.map((item) => (
            <NavLink key={item.href} item={item} current={isCurrent(item.href)} count={item.badge?.(summary) ?? 0} layout="bottom" />
          ))}
        </ul>
      </nav>
      <aside className="hidden w-60 shrink-0 flex-col border-e border-line bg-surface md:sticky md:top-0 md:flex md:h-screen">
        <div className="flex h-14 items-center px-5">
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
  const badge =
    count > 0 ? (
      <span
        className={cn(
          "tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-semibold leading-none text-white",
          layout === "bottom" && "absolute -top-1 -end-2.5",
        )}
        aria-label={`${formatNumberFa(count)} مورد خوانده‌نشده`}
      >
        {formatNumberFa(count > 99 ? 99 : count)}
      </span>
    ) : null;

  if (layout === "bottom") {
    return (
      <li>
        <Link
          href={item.href}
          aria-current={current ? "page" : undefined}
          className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs", current ? "font-semibold text-primary-600" : "text-text-muted")}
        >
          <span className="relative">
            <Icon className="size-5" aria-hidden />
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
          "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm",
          current ? "bg-primary-50 font-semibold text-primary-700" : "text-text-muted hover:bg-surface-sunken hover:text-text",
        )}
      >
        <Icon className="size-5" aria-hidden />
        <span className="flex-1">{item.label}</span>
        {badge}
      </Link>
    </li>
  );
}
