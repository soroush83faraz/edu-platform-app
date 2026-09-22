// What the admin frame needs on every /admin page, read once per request (React `cache`): the caller's admin
// scope (→ «مدرسه» vs «مدرسه‌ها», the organization-only entries) and the overview counts (→ the section counts in
// the rail, the landing page, the Home dashboard). One `adminOverviewQuery` serves all of them.
import { cache } from "react";
import type { Assignment } from "@/modules/iam/can";
import { isOrganizationAdmin } from "@/modules/iam/can";
import type { AdminScope } from "@/modules/iam/service";
import { adminSectionsFor, type AdminNavItem } from "./nav";
import { adminOverviewQuery, type AdminCounts } from "./overview";

export interface AdminShell {
  scope: AdminScope | null;
  counts: AdminCounts | null;
}

export const getAdminShell = cache(async (): Promise<AdminShell> => {
  const r = await adminOverviewQuery();
  return r.ok ? { scope: r.data.scope, counts: r.data.counts } : { scope: null, counts: null };
});

/** The admin nav items of a caller — order and labels from `nav.ts`, counts from the cached overview. */
export function adminNavItems(assignments: readonly Assignment[], shell: AdminShell): AdminNavItem[] {
  const org = isOrganizationAdmin(assignments);
  const singleSchool = shell.scope?.kind === "school" && shell.scope.schoolIds.length === 1;
  const c = shell.counts;
  return adminSectionsFor({ org, singleSchool }).map((item) =>
    c && (item.key === "students" || item.key === "staff" || item.key === "classes") ? { ...item, count: c[item.key] } : item,
  );
}
