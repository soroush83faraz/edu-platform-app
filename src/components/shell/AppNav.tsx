"use client";

import { CircleHelp, Ellipsis, House, Inbox, type LucideIcon, Presentation, School, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { DoninoWordmark } from "@/components/brand/DoninoMark";
import { RoleMark } from "@/components/brand/RoleMark";
import type { RoleKey } from "@/components/brand/roles";
import { CountBadge } from "@/components/CountBadge";
import { useInboxSummaryContext } from "@/components/shell/InboxSummaryProvider";
import { formatNumberFa } from "@/lib/format";
import { ADMIN_SECTION_ICONS, type AdminNavItem } from "@/lib/admin/nav";
import type { NavRole } from "@/modules/iam/can";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The primary item: a bigger bare glyph (24 px) — no container of its own. */
  primary?: boolean;
  /** Carries the کارتابل's unread count (the yellow `CountBadge`). */
  badge?: boolean;
}

// The glyph is a house again (UX review 2026-09-27, owner): `LayoutGrid` read as an app launcher, not a school.
const HOME: Item = { href: "/home", label: "خانه", icon: House, primary: true };
const INBOX: Item = { href: "/inbox", label: "پنل من", icon: Inbox, badge: true };
const MORE: Item = { href: "/more", label: "بیشتر", icon: Ellipsis };

/** The first item speaks for the person's highest hat (`navRoleFor`); with no hat it points at the guide. */
const ROLE_ITEMS: Record<NavRole | "none", Item> = {
  admin: { href: "/admin", label: "مدیریت", icon: Settings2 },
  teacher: { href: "/classes", label: "کلاس‌ها", icon: Presentation },
  student: { href: "/my-class", label: "کلاس من", icon: School },
  none: { href: "/help", label: "راهنما", icon: CircleHelp },
};

const COLUMNS = 4;

/**
 * The one navigation component: bottom bar on phones, start-side rail from `lg:`. FOUR items, the same order in
 * both renderings, RTL (first = start/right): «خانه» · «پنل من» · the role item · «بیشتر» (UX review 2026-09-27,
 * owner — reverses round 4/5, which had moved «پنل من» onto Home: the کارتابل is where a person goes many times a
 * day, so it is a nav destination with its unread badge, and Home no longer carries a tile for it). The role item
 * speaks for the highest hat (`navRoleFor`): «کلاس من» / «کلاس‌ها» / «مدیریت», «راهنما» with none. «اعلان‌ها»
 * stays the bell on Home's greeting row.
 * Every cell sits at the same level — no container, no raised tab, no notch, no lift (owner's rule): «خانه» reads
 * as the primary item by ONE thing, a bigger bare glyph (24 px against the others' 20 px) in `primary-600` while it
 * is the current tab. The current item is a WHOLE tinted cell — a `primary-50` rounded-lg block inset 4 px, glyph
 * and label in `primary-700` — and the bottom bar slides ONE such cell between its four columns. Nothing else moves
 * (the neighbour drift is gone: motion is for feedback, not decoration). The rail (264 px from `lg:`) opens with
 * the «دانینو» wordmark — the PRODUCT's own mark, never the role's — and the school under it, carrying the ROLE
 * mark; it lists the same four, and inside /admin nests the admin sections under «مدیریت».
 */
export function AppNav({ schoolName, productName, role, hats = [], adminItems }: { schoolName: string; productName?: string; role: NavRole | null; hats?: readonly RoleKey[]; adminItems?: readonly AdminNavItem[] }) {
  const pathname = usePathname();
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const roleItem = ROLE_ITEMS[role ?? "none"];
  // Inside /admin the rail opens the admin sections under «مدیریت» (phones keep the pill row in the content); the
  // sections never contain /admin itself, so the parent is not repeated (`adminNavItems`).
  const nested = role === "admin" && adminItems && isCurrent("/admin") ? adminItems : null;
  const items: Item[] = [HOME, INBOX, roleItem, MORE];
  // The کارتابل's unread count, from the shell's one summary poller (zeros outside the shell).
  const unread = useInboxSummaryContext().unread;
  // The bottom bar has ONE tinted cell that slides between the four columns; off-tab routes (/change-password)
  // hide it. While hidden it only fades, so it never slides across the bar when it comes back.
  const activeIndex = items.findIndex((item) => isCurrent(item.href));

  return (
    <>
      <nav aria-label="پیمایش اصلی" className="fixed inset-x-0 bottom-0 z-20 border-t border-line/70 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden">
        <ul className="relative grid grid-cols-4">
          <li
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-1 w-1/4 px-1 duration-(--duration-base) ease-(--ease-in-out)",
              activeIndex < 0 ? "transition-[opacity]" : "transition-[inset-inline-start,opacity]",
            )}
            style={{ insetInlineStart: `${Math.max(activeIndex, 0) * (100 / COLUMNS)}%`, opacity: activeIndex < 0 ? 0 : 1 }}
          >
            <span className="block h-full w-full rounded-lg bg-primary-50" />
          </li>
          {items.map((item) => (
            <NavLink key={item.href} item={item} current={isCurrent(item.href)} count={item.badge ? unread : 0} layout="bottom" />
          ))}
        </ul>
      </nav>
      <aside className="hidden w-rail shrink-0 flex-col border-e border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen">
        {/* The «دانینو» wordmark — the one place the product introduces itself — with the school on its own line
            under it, opened by the ROLE mark (the desktop's answer to the phone header's emblem). */}
        <div className="flex min-h-20 flex-col justify-center gap-1.5 px-5 py-2">
          <DoninoWordmark name={productName ?? schoolName} size={40} />
          {productName ? (
            <span className="flex min-w-0 items-center gap-2">
              {hats.length > 0 ? <RoleMark hats={hats} tone="line" /> : null}
              <bdi className="truncate text-meta text-text-muted">{schoolName}</bdi>
            </span>
          ) : null}
        </div>
        <nav aria-label="پیمایش اصلی" className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                // With the sections open, «مدیریت» itself is current only on the landing page.
                current={nested && item.href === "/admin" ? pathname === "/admin" : isCurrent(item.href)}
                count={item.badge ? unread : 0}
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
  // The primary glyph is the only one that changes size; every glyph keeps the same 28 px box so every
  // label sits on one line.
  const glyph = (
    <Icon
      className={cn(
        "transition-base",
        item.primary ? cn("size-6", current ? "text-primary-600" : "text-text-muted") : layout === "side" ? cn("size-5", current ? "text-primary-700" : "text-text-faint") : "size-5",
      )}
      strokeWidth={2}
      aria-hidden
    />
  );

  if (layout === "bottom") {
    return (
      <li>
        <Link
          href={item.href}
          aria-current={current ? "page" : undefined}
          className={cn("group pressable relative flex min-h-14 flex-col px-1 py-1 text-meta", current ? "font-semibold text-primary-700" : "text-text-muted hover:text-text")}
        >
          {/* The sliding tinted cell lives on the <ul>; this block is the same shape so a press tints the whole cell too. */}
          <span
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg pt-1 pb-0.5 transition-base",
              !current && "group-active:bg-primary-50 group-active:text-primary-700",
            )}
          >
            <span className="relative flex h-7 w-12 items-center justify-center">
              {glyph}
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
        {/* Every glyph sits in a 36 px box so the labels line up down the rail. */}
        <span className="grid size-9 shrink-0 place-items-center">{glyph}</span>
        <span className="flex-1">{item.label}</span>
        {badge}
      </Link>
      {children}
    </li>
  );
}
