import { BookOpen, CalendarDays, ChevronLeft, GraduationCap, Layers } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminPage";
import { RowMark } from "@/components/RowMark";
import { adminOverviewQuery } from "@/lib/admin/overview";
import { formatNumberFa } from "@/lib/format";

export const metadata: Metadata = { title: "تنظیمات زیرساختی | مدیریت" };

/**
 * /admin/infrastructure — «تنظیمات زیرساختی»: the organization-wide building blocks the schools are made of —
 * مقطع‌ها → پایه‌ها → درس‌ها (catalogs shared by every school) and سال‌های تحصیلی (per school). Each row opens the
 * full list page where the organization admin DEFINES and DELETES them; this hub is the one door to that group,
 * replacing the old «راه‌اندازی مدرسه» checklist (owner). Organization admins only — a school-scoped admin who
 * types the URL gets the Persian not-found page, decided from the database scope, not the hidden nav entry.
 */
export default async function InfrastructurePage() {
  const result = await adminOverviewQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    redirect("/home");
  }
  if (result.data.scope.kind !== "organization") notFound();
  const c = result.data.counts;
  const rows = [
    { href: "/admin/levels", icon: Layers, title: "مقطع‌ها", detail: "ابتدایی، متوسطهٴ اول، متوسطهٴ دوم", count: c.levels },
    { href: "/admin/grades", icon: GraduationCap, title: "پایه‌ها", detail: "دهم، یازدهم، دوازدهم — زیر هر مقطع", count: c.grades },
    { href: "/admin/subjects", icon: BookOpen, title: "درس‌ها", detail: "فهرست درس‌های سازمان", count: c.subjects },
    { href: "/admin/years", icon: CalendarDays, title: "سال‌های تحصیلی", detail: "سال و نوبت‌های هر مدرسه", count: c.years },
  ];
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title="تنظیمات زیرساختی" description="پایه‌ها، درس‌ها و سال تحصیلی سازمان را این‌جا تعریف و حذف می‌کنید؛ مدرسه‌ها از این‌ها ساخته می‌شوند." />
      <ul className="surface-work divide-y divide-line/70">
        {rows.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="surface-link pressable flex min-h-14 items-center gap-3 px-4 py-2">
              <RowMark icon={r.icon} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-row font-medium text-text">{r.title}</span>
                <span className="text-meta text-text-muted">{r.detail}</span>
              </span>
              <span className="tabular text-meta text-text-muted">{formatNumberFa(r.count)}</span>
              <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
