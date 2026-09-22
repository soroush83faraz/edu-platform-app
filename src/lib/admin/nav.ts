// The admin sections — one list, pure (no server imports), so the rail (client), the phone pill row (client), the
// admin layout and the tests all read the same order and glyphs. Ordered by how often an admin opens each
// (owner): people and classes first, structure next, roles and setup last. «نمای کلی» is the /admin landing.
import { BookOpen, CalendarDays, GraduationCap, Layers, LayoutGrid, type LucideIcon, Rocket, School, ShieldCheck, UserCheck, Users, UsersRound } from "lucide-react";

export type AdminSectionKey = "overview" | "students" | "staff" | "classes" | "attendance" | "schools" | "years" | "grades" | "subjects" | "levels" | "roles" | "onboarding";

export interface AdminSection {
  key: AdminSectionKey;
  href: string;
  labelFa: string;
  icon: LucideIcon;
  /** Organization admins only («راه‌اندازی»: school setup belongs to whoever defines schools — the owner's rule). */
  orgOnly?: boolean;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: "overview", href: "/admin", labelFa: "نمای کلی", icon: LayoutGrid },
  { key: "students", href: "/admin/students", labelFa: "دانش‌آموزان", icon: GraduationCap },
  { key: "staff", href: "/admin/staff", labelFa: "کارکنان", icon: UsersRound },
  { key: "classes", href: "/admin/classes", labelFa: "کلاس‌ها", icon: Users },
  { key: "attendance", href: "/admin/attendance", labelFa: "حضور و غیاب", icon: UserCheck },
  { key: "schools", href: "/admin/schools", labelFa: "مدرسه‌ها", icon: School },
  { key: "years", href: "/admin/years", labelFa: "سال تحصیلی", icon: CalendarDays },
  { key: "grades", href: "/admin/grades", labelFa: "پایه‌ها", icon: Layers },
  { key: "subjects", href: "/admin/subjects", labelFa: "درس‌ها", icon: BookOpen },
  { key: "levels", href: "/admin/levels", labelFa: "مقطع‌ها", icon: Layers },
  { key: "roles", href: "/admin/roles", labelFa: "نقش‌ها", icon: ShieldCheck },
  { key: "onboarding", href: "/admin/onboarding", labelFa: "راه‌اندازی", icon: Rocket, orgOnly: true },
];

/** The serializable shape the client nav components receive (icons resolve by `key` on the client). */
export interface AdminNavItem {
  key: AdminSectionKey;
  href: string;
  labelFa: string;
  orgOnly?: boolean;
  /** A count beside the label where it is cheap (students, staff, classes). */
  count?: number;
}

/** What a caller sees: school-scoped admins (principal, vice principal) lose the organization-only entries. */
export function adminSectionsFor(opts: { org: boolean; singleSchool: boolean }): AdminNavItem[] {
  return ADMIN_SECTIONS.filter((s) => !s.orgOnly || opts.org).map((s) => ({
    key: s.key,
    href: s.href,
    labelFa: s.key === "schools" ? schoolsLabelFa(opts) : s.labelFa,
    ...(s.orgOnly ? { orgOnly: true } : {}),
  }));
}

/**
 * «مدرسه» for a school-scoped admin who manages exactly ONE school, «مدرسه‌ها» for the organization admin and for
 * anyone whose scope spans two or more schools (owner's rule). Used by the nav, the page title and the overview row.
 */
export function schoolsLabelFa(scope: { kind: "organization" } | { kind: "school"; schoolIds: readonly string[] } | { org: boolean; singleSchool: boolean }): string {
  if ("org" in scope) return !scope.org && scope.singleSchool ? "مدرسه" : "مدرسه‌ها";
  return scope.kind === "school" && scope.schoolIds.length === 1 ? "مدرسه" : "مدرسه‌ها";
}

export const ADMIN_SECTION_ICONS: Record<AdminSectionKey, LucideIcon> = Object.fromEntries(ADMIN_SECTIONS.map((s) => [s.key, s.icon])) as Record<AdminSectionKey, LucideIcon>;
