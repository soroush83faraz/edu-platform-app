"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "cn";
import { ADMIN_SECTION_ICONS, type AdminNavItem } from "@/lib/admin/nav";
import { formatNumberFa } from "@/lib/format";

/**
 * The admin sections on phones and tablets: one horizontally scrollable, snap-scrolled row of 44 px pills — a
 * lucide glyph at 18 px and a 13 px label, the current pill `primary-50` with `primary-700` text and kept in view.
 * Not shown on the /admin landing page (its section list IS the navigation there) and not from `lg:` (the rail
 * nests the same links under «مدیریت»). Active = exact match or a sub-path.
 */
export function AdminNav({ items }: { items: readonly AdminNavItem[] }) {
  const pathname = usePathname();
  const scroller = useRef<HTMLUListElement>(null);
  const active = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`));
  const landing = pathname === "/admin";

  // Keep the current pill in view when the row is wider than the screen (manual scrollLeft math: no page jump, RTL-safe).
  useEffect(() => {
    const box = scroller.current;
    const pill = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !pill || box.scrollWidth <= box.clientWidth) return;
    const boxRect = box.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    box.scrollLeft += pillRect.left - boxRect.left - (boxRect.width - pillRect.width) / 2;
  }, [pathname]);

  if (landing) return null;
  return (
    <nav aria-label="بخش‌های مدیریت" className="-mx-4 lg:hidden">
      <ul ref={scroller} className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => {
          const current = active(it.href);
          const Glyph = ADMIN_SECTION_ICONS[it.key];
          return (
            <li key={it.href} className="snap-start">
              <Link
                href={it.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-meta whitespace-nowrap ring-1 ring-inset",
                  current ? "bg-primary-50 font-semibold text-primary-700 ring-primary-200" : "bg-surface text-text-muted ring-line hover:text-text",
                )}
              >
                <Glyph className={cn("size-4.5 shrink-0", current ? "text-primary-700" : "text-text-faint")} strokeWidth={1.75} aria-hidden />
                {it.labelFa}
                {it.count !== undefined ? <span className={cn("tabular", current ? "text-primary-700/80" : "text-text-faint")}>{formatNumberFa(it.count)}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
