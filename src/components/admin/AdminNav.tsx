"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

/** Horizontal, scrollable sub-navigation of /admin (chips). Active = exact match or a sub-path. */
export function AdminNav({ items }: { items: Array<{ href: string; labelFa: string }> }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`));
  return (
    <nav aria-label="بخش‌های مدیریت" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex w-max gap-2 py-1">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={active(it.href) ? "page" : undefined}
              className={cn(
                "inline-flex h-10 items-center rounded-full border px-4 text-sm whitespace-nowrap transition-base",
                active(it.href) ? "border-primary-600 bg-primary-50 font-semibold text-primary-700" : "border-line bg-surface text-text-muted hover:border-line-strong hover:text-text",
              )}
            >
              {it.labelFa}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
