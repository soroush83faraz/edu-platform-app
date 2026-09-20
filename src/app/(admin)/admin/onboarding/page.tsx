import { Check, ChevronLeft, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "cn";
import { AdminHeader } from "@/components/admin/AdminPage";
import { adminOverviewQuery, type AdminCounts } from "@/lib/admin/overview";
import { formatNumberFa } from "@/lib/format";

export const metadata: Metadata = { title: "راه‌اندازی مدرسه | سامانهٴ مدرسه" };

interface Step {
  href: string;
  title: string;
  done: boolean;
  detail: string;
  warn?: boolean;
}

function steps(c: AdminCounts): Step[] {
  const n = formatNumberFa;
  return [
    { href: "/admin/schools", title: "مدرسه و شعبه", done: c.schools > 0 && c.branches > 0, detail: c.schools > 0 ? `${n(c.schools)} مدرسه، ${n(c.branches)} شعبه` : "هنوز مدرسه‌ای ثبت نشده" },
    { href: "/admin/years", title: "سال تحصیلی جاری و نوبت‌ها", done: c.currentYears > 0 && c.terms > 0, detail: c.currentYears > 0 ? `${n(c.currentYears)} سال جاری، ${n(c.terms)} نوبت` : "سال جاری را تعریف کنید" },
    { href: "/admin/grades", title: "پایه‌ها", done: c.grades > 0, detail: c.grades > 0 ? `${n(c.grades)} پایه در ${n(c.levels)} مقطع` : "پایه‌ای تعریف نشده" },
    { href: "/admin/subjects", title: "درس‌ها", done: c.subjects > 0, detail: c.subjects > 0 ? `${n(c.subjects)} درس` : "درسی تعریف نشده" },
    { href: "/admin/classes", title: "کلاس‌ها", done: c.classes > 0, detail: `${n(c.classes)} کلاس فعال` },
    { href: "/admin/classes", title: "ارائهٴ درس در کلاس‌ها", done: c.offerings > 0, detail: `${n(c.offerings)} ارائه${c.offeringsWithoutTeacher > 0 ? `، ${n(c.offeringsWithoutTeacher)} بدون دبیر` : ""}`, warn: c.offeringsWithoutTeacher > 0 },
    { href: "/admin/staff", title: "دبیران", done: c.staff > 0, detail: `${n(c.staff)} نفر کادر، ${n(c.teachers)} دبیر با تخصیص` },
    { href: "/admin/classes", title: "تخصیص دبیر به کلاس‌درس", done: c.teacherAssignments > 0 && c.offeringsWithoutTeacher === 0, detail: `${n(c.teacherAssignments)} تخصیص` },
    { href: "/admin/students", title: "دانش‌آموزان", done: c.students > 0, detail: `${n(c.students)} دانش‌آموز` },
    { href: "/admin/students?noclass=1", title: "ثبت‌نام فعال در کلاس", done: c.students > 0 && c.studentsWithoutClass === 0, detail: `${n(c.activeEnrollments)} ثبت‌نام فعال${c.studentsWithoutClass > 0 ? `، ${n(c.studentsWithoutClass)} بدون کلاس` : ""}`, warn: c.studentsWithoutClass > 0 },
    { href: "/admin/students?pending=1", title: "حساب‌های فعال‌نشده (رمز اولیه)", done: c.accountsPending === 0, detail: c.accountsPending > 0 ? `${n(c.accountsPending)} حساب هنوز رمز اولیه دارد — اعتبارنامه‌ها را چاپ و توزیع کنید` : "همه رمز خود را تغییر داده‌اند", warn: c.accountsPending > 0 },
  ];
}

/** /admin/onboarding — what is done and what is missing before students can log in on ۱ مهر. */
export default async function OnboardingPage() {
  const result = await adminOverviewQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    redirect("/home");
  }
  const list = steps(result.data.counts);
  const done = list.filter((s) => s.done).length;
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title="راه‌اندازی مدرسه" description="ترتیب پیشنهادی از بالا به پایین؛ هر ردیف به بخش مربوط می‌رود." />
      <div className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={done}>
          <div className="h-full rounded-full bg-success" style={{ width: `${Math.round((done / list.length) * 100)}%` }} />
        </div>
        <span className="tabular text-sm font-medium text-text">
          {formatNumberFa(done)}/{formatNumberFa(list.length)}
        </span>
      </div>
      <ol className="divide-y divide-line rounded-card border border-line bg-surface">
        {list.map((s, i) => (
          <li key={`${s.href}-${i}`}>
            <Link href={s.href} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-sunken">
              {s.done ? <Check className="size-5 shrink-0 text-success" aria-label="انجام شده" /> : <CircleDashed className={cn("size-5 shrink-0", s.warn ? "text-warning" : "text-text-faint")} aria-label="انجام نشده" />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-base", s.done ? "text-text" : "font-medium text-text")}>{s.title}</span>
                <span className={cn("text-xs", s.warn && !s.done ? "text-warning" : "text-text-muted")}>{s.detail}</span>
              </span>
              <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
