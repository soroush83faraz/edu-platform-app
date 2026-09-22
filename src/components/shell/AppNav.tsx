"use client";

import { Bell, BookOpen, CircleHelp, Ellipsis, House, Inbox, type LucideIcon, Presentation, School, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { ClayIcon } from "@/components/ClayIcon";
import { CountBadge } from "@/components/CountBadge";
import { formatNumberFa } from "@/lib/format";
import { ADMIN_SECTION_ICONS, type AdminNavItem } from "@/lib/admin/nav";
import type { NavRole } from "@/modules/iam/can";
import { useInboxSummaryContext } from "./InboxSummaryProvider";
import type { InboxSummaryState } from "./useInboxSummary";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: (s: InboxSummaryState) => number;
  /** The primary item: its glyph sits in a small filled persian-blue squircle (the 36 px `sm` clay mark) instead of bare. */
  primary?: boolean;
}

const HOME: Item = { href: "/home", label: "خانه", icon: House, primary: true };
const INBOX: Item = { href: "/inbox", label: "پنل من", icon: Inbox, badge: (s) => s.unread };
const NOTIFICATIONS: Item = { href: "/notifications", label: "اعلان‌ها", icon: Bell, badge: (s) => s.unreadNotifications };
const MORE: Item = { href: "/more", label: "بیشتر", icon: Ellipsis };

/** The fourth item speaks for the person's highest hat (`navRoleFor`); with no hat it points at the guide. */
const ROLE_ITEMS: Record<NavRole | "none", Item> = {
  admin: { href: "/admin", label: "مدیریت", icon: Settings2 },
  teacher: { href: "/classes", label: "کلاس‌ها", icon: Presentation },
  student: { href: "/my-class", label: "کلاس من", icon: School },
  none: { href: "/help", label: "راهنما", icon: CircleHelp },
};

const COLUMNS = 5;

/**
 * The one navigation component: bottom bar on phones, start-side rail from `md:`. Five items — پنل من · اعلان‌ها ·
 * خانه · a role item · بیشتر (RTL: the first is at the start/right). «خانه» sits in the middle at the same level and
 * size as the rest; it reads as the primary item only by its glyph sitting in a small filled persian-blue squircle
 * (owner's rule: no raised tab, no notch, no lift). The current item is a WHOLE tinted cell — a `primary-50`
 * rounded-lg block inset 4 px, glyph and label in `primary-700` — and the bottom bar slides ONE such cell between its
 * five columns; counts are yellow pills. The rail (264 px from `lg:`) opens with the product mark and name, lists the
 * same five with Home first and, inside /admin, nests the admin sections under «مدیریت». Both renderings read the
 * shell's single summary poller (`InboxSummaryProvider`), as do the Home strip and tile badges.
 */
export function AppNav({ schoolName, productName, role, adminItems }: { schoolName: string; productName?: string; role: NavRole | null; adminItems?: readonly AdminNavItem[] }) {
  const pathname = usePathname();
  const summary = useInboxSummaryContext();
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const roleItem = ROLE_ITEMS[role ?? "none"];
  // Inside /admin the rail opens the admin sections under «مدیریت» (phones keep the pill row in the content); the
  // «نمای کلی» entry is the parent itself, so it is not repeated.
  const nested = role === "admin" && adminItems && isCurrent("/admin") ? adminItems.filter((s) => s.key !== "overview") : null;
  const bottomItems: Item[] = [INBOX, NOTIFICATIONS, HOME, roleItem, MORE];
  const sideItems: Item[] = [HOME, INBOX, NOTIFICATIONS, roleItem, MORE];
  // The bottom bar has ONE tinted cell that slides between the five columns; off-tab routes (/change-password) hide
  // it. While hidden it only fades, so it never slides across the bar when it comes back.
  const activeIndex = bottomItems.findIndex((item) => isCurrent(item.href));

  return (
    <>
      <nav aria-label="پیمایش اصلی" className="fixed inset-x-0 bottom-0 z-20 border-t border-line/70 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden">
        <ul className="relative grid grid-cols-5">
          <li
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-1 w-1/5 px-1 duration-(--duration-base) ease-(--ease-in-out)",
              activeIndex < 0 ? "transition-[opacity]" : "transition-[inset-inline-start,opacity]",
            )}
            style={{ insetInlineStart: `${Math.max(activeIndex, 0) * (100 / COLUMNS)}%`, opacity: activeIndex < 0 ? 0 : 1 }}
          >
            <span className="block h-full w-full rounded-lg bg-primary-50" />
          </li>
          {bottomItems.map((item) => (
            <NavLink key={item.href} item={item} current={isCurrent(item.href)} count={item.badge?.(summary) ?? 0} layout="bottom" />
          ))}
        </ul>
      </nav>
      <aside className="hidden w-rail shrink-0 flex-col border-e border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen">
        {/* The product mark and name, the school under it — the one place the product introduces itself. */}
        <div className="flex min-h-20 items-center gap-3 px-5 pt-1">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-hero text-white shadow-1">
            <BookOpen className="size-5" strokeWidth={2} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-row font-bold text-text">{productName ?? schoolName}</span>
            {productName ? (
              <span className="truncate text-meta text-text-muted">
                <bdi>{schoolName}</bdi>
              </span>
            ) : null}
          </span>
        </div>
        <nav aria-label="پیمایش اصلی" className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="flex flex-col gap-1">
            {sideItems.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                // With the sections open, «مدیریت» itself is current only on the landing page.
                current={nested && item.href === "/admin" ? pathname === "/admin" : isCurrent(item.href)}
                count={item.badge?.(summary) ?? 0}
                layout="side"
              >
                {nested && item.href === "/admin" ? (
                  <ul className="mt-1 mb-1 ms-4 flex flex-col gap-0.5 border-s border-line ps-2">
                    {nested.map((sub) => {
                      const current = isCurrent(sub.href);
                      const Glyph = ADMIN_SECTION_ICONS[sub.key];
                      return (
                        <li key={sub.href}>
                          <Link
                            href={sub.href}
                            aria-current={current ? "page" : undefined}
                            className={cn(
                              "pressable flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm",
                              current ? "bg-primary-50 font-semibold text-primary-700" : "text-text-muted hover:bg-surface-sunken hover:text-text",
                            )}
                          >
                            <Glyph className={cn("size-4.5 shrink-0", current ? "text-primary-700" : "text-text-faint")} strokeWidth={1.75} aria-hidden />
                            <span className="flex-1 truncate">{sub.labelFa}</span>
                            {sub.count !== undefined ? <span className={cn("tabular text-meta", current ? "text-primary-700" : "text-text-faint")}>{formatNumberFa(sub.count)}</span> : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </NavLink>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}

function NavLink({ item, current, count, layout, children }: { item: Item; current: boolean; count: number; layout: "bottom" | "side"; children?: React.ReactNode }) {
  const Icon = item.icon;
  const badge = <CountBadge count={count} label={`${formatNumberFa(count)} مورد خوانده‌نشده`} floating={layout === "bottom"} />;

  if (layout === "bottom") {
    return (
      <li>
        <Link
          href={item.href}
          aria-current={current ? "page" : undefined}
          className={cn(
            "group pressable relative flex min-h-14 flex-col px-1 text-xs",
            // The 36 px primary mark takes the cell's vertical padding and the glyph box's 8 px of padding/gap: every
            // cell stays 60 px and the label lands within 2 px of its neighbours'.
            item.primary ? "py-0" : "py-1",
            current ? "font-semibold text-primary-700" : "text-text-muted hover:text-text",
          )}
        >
          {/* The sliding tinted cell lives on the <ul>; this block is the same shape so a press tints the whole cell too. */}
          <span
            className={cn(
              "flex flex-1 flex-col items-center justify-center rounded-lg transition-base",
              item.primary ? "gap-0" : "gap-0.5 pt-1 pb-0.5",
              !current && "group-active:bg-primary-50 group-active:text-primary-700",
            )}
          >
            <span className={cn("relative flex w-12 items-center justify-center", item.primary ? "h-9" : "h-6")}>
              {item.primary ? <ClayIcon icon={Icon} size="sm" /> : <Icon className="size-5 transition-base" strokeWidth={2} aria-hidden />}
              {badge}
            </span>
            {item.label}
          </span>
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
          "pressable flex min-h-11 items-center gap-2 rounded-lg px-2 text-row",
          current ? "bg-primary-50 font-semibold text-primary-700" : "text-text-muted hover:bg-surface-sunken hover:text-text active:bg-primary-50 active:text-primary-700",
        )}
      >
        {/* Every glyph sits in a 36 px box so the labels line up with the Home row's clay mark. */}
        <span className="grid size-9 shrink-0 place-items-center">
          {item.primary ? <ClayIcon icon={Icon} size="sm" /> : <Icon className={cn("size-5 transition-base", current ? "text-primary-700" : "text-text-faint")} strokeWidth={2} aria-hidden />}
        </span>
        <span className="flex-1">{item.label}</span>
        {badge}
      </Link>
      {children}
    </li>
  );
}
