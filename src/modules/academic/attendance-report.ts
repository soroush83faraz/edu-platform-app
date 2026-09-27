// academic/attendance-report — the reach of the admin «حضور و غیاب» report (`/admin/attendance`). Without a school
// it is the caller's admin scope (every school of the organization for the organization admin, the caller's own
// schools otherwise). With a school (`?school=<id>`, the door on that school's hub — owner, 2026-09-27: «attendance
// separate for each school») it is exactly that ONE school, checked against the same scope: a school-scoped manager
// may pass only their own school, the organization admin any school of the organization; anything else — another
// school, another tenant's school (invisible under RLS), an unknown id — is NOT_FOUND, never FORBIDDEN.
import type { Tx } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import type { Assignment } from "@/modules/iam/can";
import { assertSchoolInScope, getAdminScope } from "@/modules/iam/service";
import { findSchoolById } from "@/modules/tenancy/repo";

export interface AttendanceReportReach {
  /** The schools every report query is narrowed to; null = the whole organization (organization admin, no filter). */
  schoolIds: string[] | null;
  /** The filtered school, when there is one — the page's title and its way back to that school's hub. */
  school: { id: string; name: string } | null;
}

export async function attendanceReportReach(tx: Tx, ctx: { orgId: string; assignments: readonly Assignment[] }, schoolId?: string): Promise<AttendanceReportReach> {
  const scope = await getAdminScope(tx, ctx);
  if (!schoolId) return { schoolIds: scope.kind === "organization" ? null : scope.schoolIds, school: null };
  assertSchoolInScope(scope, schoolId);
  const sch = await findSchoolById(tx, schoolId);
  if (!sch) throw notFound();
  return { schoolIds: [sch.id], school: { id: sch.id, name: sch.name } };
}
