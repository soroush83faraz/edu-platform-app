import { Bell, Ellipsis, House, Inbox } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/ctx";

/**
 * The signed-in shell. The context comes from the database (cookie → session → membership), so a stale or
 * forged cookie lands on /login here even if proxy.ts let the request through. Real navigation comes next block.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  if (ctx.mustChangePassword) redirect("/change-password");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-neutral-50">
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background px-4">
        <h1 className="truncate text-base font-semibold">{ctx.schoolName ?? ctx.orgName}</h1>
      </header>
      <main className="flex-1 pb-20">{children}</main>
      <nav aria-label="پیمایش اصلی" className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-4">
          <NavItem href="/home" label="خانه" icon={<House className="size-5" aria-hidden />} current />
          <NavItem href="/home" label="کارتابل" icon={<Inbox className="size-5" aria-hidden />} />
          <NavItem href="/home" label="اعلان‌ها" icon={<Bell className="size-5" aria-hidden />} />
          <NavItem href="/home" label="بیشتر" icon={<Ellipsis className="size-5" aria-hidden />} />
        </ul>
      </nav>
    </div>
  );
}

function NavItem({ href, label, icon, current }: { href: string; label: string; icon: React.ReactNode; current?: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        className={`flex min-h-14 flex-col items-center justify-center gap-1 text-xs ${current ? "text-primary" : "text-muted-foreground"}`}
      >
        {icon}
        {label}
      </Link>
    </li>
  );
}
