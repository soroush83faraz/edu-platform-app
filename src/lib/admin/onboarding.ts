// The «راه‌اندازی مدرسه» checklist, computed from the admin counters. Pure: shared by /admin/onboarding and the
// Home admin card so both show the same «۷/۱۱».
import type { AdminCounts } from "@/lib/admin/overview";
import { formatNumberFa } from "@/lib/format";

export interface OnboardingStep {
  href: string;
  title: string;
  done: boolean;
  detail: string;
  warn?: boolean;
}

/**
 * `schoolId` — the ONE school of the organization, when there is exactly one — sends the first step on to that
 * school's own hub instead of the list: right after «مدرسهٴ جدید» the admin continues there with سال تحصیلی →
 * کلاس‌ها → کارکنان. With no school yet (or several) the step opens the list, as before.
 */
export function onboardingSteps(c: AdminCounts, schoolId?: string | null): OnboardingStep[] {
  const n = formatNumberFa;
  return [
    { href: schoolId ? `/admin/schools/${schoolId}` : "/admin/schools", title: "مدرسه و شعبه", done: c.schools > 0 && c.branches > 0, detail: c.schools > 0 ? `${n(c.schools)} مدرسه، ${n(c.branches)} شعبه` : "هنوز مدرسه‌ای ثبت نشده" },
    { href: "/admin/years", title: "سال تحصیلی جاری و نوبت‌ها", done: c.currentYears > 0 && c.terms > 0, detail: c.currentYears > 0 ? `${n(c.currentYears)} سال جاری، ${n(c.terms)} نوبت` : "سال جاری را تعریف کنید" },
    { href: "/admin/grades", title: "پایه‌ها", done: c.grades > 0, detail: c.grades > 0 ? `${n(c.grades)} پایه در ${n(c.levels)} مقطع` : "پایه‌ای تعریف نشده" },
    { href: "/admin/subjects", title: "درس‌ها", done: c.subjects > 0, detail: c.subjects > 0 ? `${n(c.subjects)} درس` : "درسی تعریف نشده" },
    { href: "/admin/classes", title: "کلاس‌ها", done: c.classes > 0, detail: `${n(c.classes)} کلاس فعال` },
    { href: "/admin/classes", title: "ارائهٴ درس در کلاس‌ها", done: c.offerings > 0, detail: `${n(c.offerings)} ارائه${c.offeringsWithoutTeacher > 0 ? `، ${n(c.offeringsWithoutTeacher)} بدون دبیر` : ""}`, warn: c.offeringsWithoutTeacher > 0 },
    { href: "/admin/staff", title: "دبیران", done: c.staff > 0, detail: `${n(c.staff)} نفر کادر، ${n(c.teachers)} دبیر با تخصیص` },
    { href: "/admin/classes", title: "تخصیص دبیر به کلاس‌درس", done: c.teacherAssignments > 0 && c.offeringsWithoutTeacher === 0, detail: `${n(c.teacherAssignments)} تخصیص` },
    { href: "/admin/students", title: "دانش‌آموزان", done: c.students > 0, detail: `${n(c.students)} دانش‌آموز` },
    { href: "/admin/students?noclass=1", title: "ثبت‌نام فعال در کلاس", done: c.students > 0 && c.studentsWithoutClass === 0, detail: `${n(c.activeEnrollments)} ثبت‌نام فعال${c.studentsWithoutClass > 0 ? `، ${n(c.studentsWithoutClass)} بدون کلاس` : ""}`, warn: c.studentsWithoutClass > 0 },
    { href: "/admin/students?pending=1", title: "حساب‌های فعال‌نشده (رمز اولیه)", done: c.accountsPending === 0, detail: c.accountsPending > 0 ? `${n(c.accountsPending)} حساب هنوز رمز اولیه دارد — رمزها را به صاحبانشان برسانید` : "همه رمز خود را تغییر داده‌اند", warn: c.accountsPending > 0 },
  ];
}

export function onboardingProgress(c: AdminCounts): { done: number; total: number } {
  const list = onboardingSteps(c);
  return { done: list.filter((s) => s.done).length, total: list.length };
}
