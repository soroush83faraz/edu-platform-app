// academic/leave-deciders — WHO decides a guardian's leave request, by person (owner 2026-10-20; docs/attendance.md
// «مرخصی و خروج مجاز»): the live persons whose valid role assignment carries `academic.leave.decide` AT the request's
// SCHOOL (a school-scoped assignment: the school's principal and vice principals) — exactly the people
// `decideLeave`'s `can(…, { scopeType: "school" })` accepts there, so nobody is told of a request they could not decide
// (a branch-scoped vice principal is not: security review 2026-10-20, docs/decisions.md). The organization admin holds
// the permission too, at the organization, but is never an addressee: what a guardian asks stays in the school (owner,
// 2026-10-20 — the request's response-time chain stops at the principal, src/modules/workspace/request-sla.ts). Never
// `exceptPersonId` — the guardian who asked, should they also hold an office.
//
// A leaf (tables only, no service imports) so iam (the new request's bell, ./guardian-leave) and workspace (the
// response-time clock's addressees, ./requests) both read it without an import cycle.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";

export const LEAVE_DECIDE_PERMISSION = "academic.leave.decide" as const;

/** The school's deciders by office: «مدیر مدرسه» (the SYSTEM role `school_principal`) and everyone else holding it there. */
export interface LeaveDeciders {
  principal: string[];
  vice_principal: string[];
}

/** The live holders of `academic.leave.decide` assigned AT `schoolId`, by office; sorted, distinct, never `exceptPersonId`. */
export async function leaveDeciders(tx: Tx, schoolId: string, exceptPersonId: string): Promise<LeaveDeciders> {
  const res = await tx.execute<{ person_id: string; principal: boolean }>(sql`
    select ra.person_id, bool_or(r.code = 'school_principal' and r.organization_id is null) as principal
    from iam.role_assignment ra
    join iam.role r on r.id = ra.role_id
    join iam.role_permission rp on rp.role_id = ra.role_id and rp.permission_code = ${LEAVE_DECIDE_PERMISSION}
    join iam.person p on p.id = ra.person_id and p.status = 'active'
    where ra.scope_type = 'school' and ra.school_id = ${schoolId}::uuid
      and ra.revoked_at is null
      and (ra.valid_from is null or ra.valid_from <= current_date)
      and (ra.valid_to is null or ra.valid_to >= current_date)
      and ra.person_id <> ${exceptPersonId}::uuid
    group by ra.person_id
    order by ra.person_id`);
  return {
    principal: res.rows.filter((r) => r.principal === true).map((r) => r.person_id),
    vice_principal: res.rows.filter((r) => r.principal !== true).map((r) => r.person_id),
  };
}

/** Everyone of them (the new request's bell). */
export function allDeciders(d: LeaveDeciders): string[] {
  return [...new Set([...d.principal, ...d.vice_principal])].sort();
}
