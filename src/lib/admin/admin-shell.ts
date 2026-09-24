// What the admin frame needs on every /admin page, read once per request (React `cache`): the caller's admin
// scope (→ «مدرسه» vs «مدرسه‌ها», the organization-only entries) and the overview counts (→ the section counts in
// the rail, the landing page, the Home dashboard). One `adminOverviewQuery` serves all of them.
import { cache } from "react";
import type { Assignment } from "@/modules/iam/can";
import { isOrganizationAdmin } from "@/modules/iam/can";
import type { AdminScope } from "@/modules/iam/service";
import { adminSectionsFor, type AdminNavItem } from "./nav";
import { adminOverviewQuery, type AdminCounts, type SchoolCounts } from "./overview";

export interface AdminShell {
  scope: AdminScope | null;
  counts: AdminCounts | null;
  /** One row per school when the scope holds more than one (the /admin breakdown); empty otherwise. */
  schools: SchoolCounts[];
}

export const getAdminShell = cache(async (): Promise<AdminShell> => {
  const r = await adminOverviewQuery();
  return r.ok ? { scope: r.data.scope, counts: r.data.counts, schools: r.data.schools ?? [] } : { scope: null, counts: null, schools: [] };
});

/**
 * The admin SECTIONS of a caller — order and labels from `nav.ts`, counts from the cached overview. «نمای کلی» is
 * dropped: /admin is the hub itself (the landing page, the rail's «مدیریت», the phone nav's role item), so listing
 * it among its own sections would be a second door to a place you are already in — one home per destination
 * (docs/decisions.md). The organization-only entries («مدرسه‌ها», «راه‌اندازی مدرسه») are dropped for a
 * school-scoped admin by `adminSectionsFor`.
 *
 * Every section carries the count its page holds, so the rail, the phone pill row and the landing rows all read
 * the same number: how many students/staff/classes/schools there are — and, for «راه‌اندازی مدرسه», how many
 * setup steps are still MISSING (the one number that page is about; its hint says so in words).
 */
export function adminNavItems(assignments: readonly Assignment[], shell: AdminShell): AdminNavItem[] {
  const org = isOrganizationAdmin(assignments);
  const c = shell.counts;
  return adminSectionsFor({ org })
    .filter((item) => item.key !== "overview")
    .map((item) => {
      if (!c) return item;
      if (item.key === "students" || item.key === "staff" || item.key === "classes" || item.key === "schools") return { ...item, count: c[item.key] };
      if (item.key === "roles") return { ...item, count: c.managerRoles };
      return item;
    });
}
