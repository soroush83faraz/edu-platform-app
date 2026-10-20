// academic/leave-deciders — WHO decides a guardian's leave request, by person (owner 2026-10-20; docs/attendance.md
// «مرخصی و خروج مجاز»): the live persons whose valid role assignment carries `academic.leave.decide` AT the request's
// SCHOOL (a school-scoped assignment: the school's principal and vice principals) — exactly the people
// `decideLeave`'s `can(…, { scopeType: "school" })` accepts there, so nobody is told of a request they could not decide
// (a branch-scoped vice principal is not: security review 2026-10-20, docs/decisions.md) — and, one level up, the
// organization-scoped holders (the organization admin), whom only an ESCALATION of the request's response time reaches
// (src/modules/workspace/requests.ts). Never `exceptPersonId` — the guardian who asked, should they also hold an office.
//
// A leaf (tables only, no service imports) so iam (the new request's bell, ./guardian-leave) and workspace (the
// response-time clock's addressees) both read it without an import cycle.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";

export const LEAVE_DECIDE_PERMISSION = "academic.leave.decide" as const;

/**
 * The live holders of `academic.leave.decide` at `level`: `school` = assigned AT `schoolId` (not a branch of it, not
 * the organization); `organization` = organization-scoped. Sorted, distinct; never `exceptPersonId`.
 */
export async function leaveDeciders(tx: Tx, input: { schoolId: string; level: "school" | "organization"; exceptPersonId: string }): Promise<string[]> {
  const where =
    input.level === "school" ? sql`ra.scope_type = 'school' and ra.school_id = ${input.schoolId}::uuid` : sql`ra.scope_type = 'organization'`;
  const res = await tx.execute<{ person_id: string }>(sql`
    select distinct ra.person_id
    from iam.role_assignment ra
    join iam.role_permission rp on rp.role_id = ra.role_id and rp.permission_code = ${LEAVE_DECIDE_PERMISSION}
    join iam.person p on p.id = ra.person_id and p.status = 'active'
    where ${where}
      and ra.revoked_at is null
      and (ra.valid_from is null or ra.valid_from <= current_date)
      and (ra.valid_to is null or ra.valid_to >= current_date)
      and ra.person_id <> ${input.exceptPersonId}::uuid
    order by ra.person_id`);
  return res.rows.map((r) => r.person_id);
}
