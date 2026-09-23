// The admin sections — one list, pure (no server imports), so the rail (client), the phone pill row (client), the
// admin layout and the tests all read the same order and glyphs. «نمای کلی» is the /admin landing.
//
// Owner, QA round 5: «مدیریت» is a focused area for PEOPLE AND THEIR ROLES — دانش‌آموزان · کارکنان · کلاس‌ها ·
// نقش‌ها. Everything that describes the school's STRUCTURE (سال تحصیلی، پایه‌ها، درس‌ها، مقطع‌ها) and the admin's
// «حضور و غیاب» report left this nav and became its own Home tile — one door per destination, and that door is
// now on Home (docs/decisions.md «one home per destination»). The pages themselves are untouched and still
// render inside the admin shell.
//
// Round 7 (owner) brought TWO of them back, for the ORGANIZATION ADMIN alone: «مدرسه‌ها» (the list where schools
// are defined) and «راه‌اندازی مدرسه» (the setup checklist). Both are ordinary sections here — same shape, same
// glyph, same pill/rail rendering as their neighbours, no panel of their own on the landing page — and both are
// `orgOnly`, so a school-scoped admin never meets them. Their Home tiles are gone: one door per destination
// still holds, per person (a principal keeps the «مدرسه» tile that opens THEIR school's hub, which is a
// different destination from the organization's list).
import { GraduationCap, LayoutGrid, type LucideIcon, Rocket, School, ShieldCheck, Users, UsersRound } from "lucide-react";

export type AdminSectionKey = "overview" | "students" | "staff" | "classes" | "roles" | "schools" | "setup";

export interface AdminSection {
  key: AdminSectionKey;
  href: string;
  labelFa: string;
  icon: LucideIcon;
  /** Organization admins only: whoever defines the schools of the organization and sets them up. */
  orgOnly?: boolean;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: "overview", href: "/admin", labelFa: "نمای کلی", icon: LayoutGrid },
  { key: "students", href: "/admin/students", labelFa: "دانش‌آموزان", icon: GraduationCap },
  { key: "staff", href: "/admin/staff", labelFa: "کارکنان", icon: UsersRound },
  { key: "classes", href: "/admin/classes", labelFa: "کلاس‌ها", icon: Users },
  { key: "roles", href: "/admin/roles", labelFa: "نقش‌ها", icon: ShieldCheck },
  { key: "schools", href: "/admin/schools", labelFa: "مدرسه‌ها", icon: School, orgOnly: true },
  { key: "setup", href: "/admin/onboarding", labelFa: "راه‌اندازی مدرسه", icon: Rocket, orgOnly: true },
];

/** Every key the admin nav still owns — a resource page NOT in this set moved to Home and needs its own way back. */
export const ADMIN_SECTION_KEYS: ReadonlySet<string> = new Set(ADMIN_SECTIONS.map((s) => s.key));

/**
 * Is this resource page one of THIS caller's sections? A section page needs no «خانه» back link (the pill row /
 * rail is its way around), a page that is only a Home tile does. «مدرسه‌ها» is both, depending on the caller:
 * a section for the organization admin, a Home tile for a school-scoped admin.
 */
export function isAdminSectionFor(key: string, opts: { org: boolean }): boolean {
  return ADMIN_SECTIONS.some((s) => s.key === key && (!s.orgOnly || opts.org));
}

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
export function adminSectionsFor(opts: { org: boolean }): AdminNavItem[] {
  return ADMIN_SECTIONS.filter((s) => !s.orgOnly || opts.org).map((s) => ({
    key: s.key,
    href: s.href,
    labelFa: s.labelFa,
    ...(s.orgOnly ? { orgOnly: true } : {}),
  }));
}

/**
 * «مدرسه» for a school-scoped admin who manages exactly ONE school, «مدرسه‌ها» for the organization admin and for
 * anyone whose scope spans two or more schools (owner's rule). Used by the Home tile, the page title and the
 * /admin breakdown.
 */
export function schoolsLabelFa(scope: { kind: "organization" } | { kind: "school"; schoolIds: readonly string[] } | { org: boolean; singleSchool: boolean }): string {
  if ("org" in scope) return !scope.org && scope.singleSchool ? "مدرسه" : "مدرسه‌ها";
  return scope.kind === "school" && scope.schoolIds.length === 1 ? "مدرسه" : "مدرسه‌ها";
}

export const ADMIN_SECTION_ICONS: Record<AdminSectionKey, LucideIcon> = Object.fromEntries(ADMIN_SECTIONS.map((s) => [s.key, s.icon])) as Record<AdminSectionKey, LucideIcon>;
