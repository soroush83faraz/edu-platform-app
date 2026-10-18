// «ورود آزمایشی» — its queries. Every function takes `tx`; whether it must be the global transaction or a tenant
// one opened by `demoOrgTx` (src/lib/actions/defineDemoAction — allow-listed organizations only) is stated per
// function. Explicit columns, no `select *`.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { roleHatsFor } from "@/components/brand/roles";
import { organization } from "@/modules/tenancy/schema";
import type { ScopeType } from "../permissions";
import { organizationMembership, person, userAccount } from "../schema";
import type { DemoAccountFacts, DemoMembershipFacts } from "./eligibility";
import type { DemoManagerHat, DemoManagerHatKey, DemoPerson, DemoSchoolFacts, DemoStudentPlace, DemoTeaching } from "./labels";

/** `user_session.device_label` of every demo session (src/modules/iam/session.ts `deviceLabel`). */
export const DEMO_SESSION_LABEL = "demo-login";

/**
 * How many demo sessions may be created in ten minutes — from one IP, and in all. Keyed: generous for one owner
 * clicking through views; a runaway script or a leaked unlock cookie hits the wall. Open mode (DEMO_LOGIN_OPEN=1)
 * tightens the per-IP cap to 20: there a client proves nothing, and 20 is still one account switch every 30 seconds
 * for a person trying roles by hand. The global cap stays 200 in both modes — it is what bounds the writes of all
 * clients together (≤ 200 sessions + 200 audit rows per 10 minutes), and a lower one would only make it cheaper for
 * a handful of addresses to lock every pilot tester out.
 */
export const DEMO_RATE = { perIp10m: 30, perIp10mOpen: 20, all10m: 200 } as const;

/** The caps the demo login applies in this mode. */
export function demoRateCaps(open: boolean): { perIp10m: number; all10m: number } {
  return { perIp10m: open ? DEMO_RATE.perIp10mOpen : DEMO_RATE.perIp10m, all10m: DEMO_RATE.all10m };
}

/** Global. */
export async function findDemoAccount(tx: Tx, accountId: string): Promise<DemoAccountFacts | null> {
  const rows = await tx
    .select({ id: userAccount.id, status: userAccount.status, mustChangePassword: userAccount.mustChangePassword, lockedUntil: userAccount.lockedUntil })
    .from(userAccount)
    .where(eq(userAccount.id, accountId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * EVERY membership of the account — any status, in any organization — with its organization's slug and status.
 * The caller MUST bind the account first (`tools.bindAccount(tx, account.id)`): only the `account_memberships`
 * policy shows memberships outside the transaction's tenant, and without it an account that also belongs to a real
 * school would look like a demo-only one.
 */
export async function listDemoMemberships(tx: Tx, accountId: string): Promise<DemoMembershipFacts[]> {
  return tx
    .select({
      organizationId: organizationMembership.organizationId,
      orgSlug: organization.slug,
      orgStatus: organization.status,
      status: organizationMembership.status,
      personId: organizationMembership.personId,
      isDefaultOrg: organizationMembership.isDefaultOrg,
      joinedAt: organizationMembership.joinedAt,
    })
    .from(organizationMembership)
    .innerJoin(organization, eq(organization.id, organizationMembership.organizationId))
    .where(eq(organizationMembership.userAccountId, accountId));
}

/** Tenant (the target organization). The membership is still active and the person behind it still active. */
export async function isLiveDemoMember(tx: Tx, accountId: string, personId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: person.id })
    .from(organizationMembership)
    .innerJoin(person, eq(person.id, organizationMembership.personId))
    .where(
      and(
        eq(organizationMembership.userAccountId, accountId),
        eq(organizationMembership.personId, personId),
        eq(organizationMembership.status, "active"),
        eq(person.status, "active"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Global. Demo sessions created in the last ten minutes — from `ip`, and in all. */
export async function countRecentDemoSessions(tx: Tx, ip: string): Promise<{ ip: number; all: number }> {
  const res = await tx.execute<{ by_ip: number; total: number }>(sql`
    select
      count(*) filter (where ip = ${ip}::inet)::int as by_ip,
      count(*)::int as total
    from iam.user_session
    where device_label = ${DEMO_SESSION_LABEL}
      and created_at > now() - interval '10 minutes'
  `);
  const row = res.rows[0];
  return { ip: Number(row?.by_ip ?? 0), all: Number(row?.total ?? 0) };
}

/** Global. The allow-listed organizations that exist and are active, in the order the list names them. */
export async function findDemoOrgs(tx: Tx, slugs: readonly string[]): Promise<Array<{ id: string; name: string; slug: string }>> {
  if (slugs.length === 0) return [];
  const rows = await tx
    .select({ id: organization.id, name: organization.name, slug: organization.slug, status: organization.status })
    .from(organization)
    .where(inArray(organization.slug, [...slugs]));
  return rows
    .filter((r) => r.status === "active")
    .sort((a, b) => slugs.indexOf(a.slug) - slugs.indexOf(b.slug))
    .map(({ id, name, slug }) => ({ id, name, slug }));
}

// ---- the panel's list: tenant reads, one `demoOrgTx` per allow-listed organization ----

/** Tenant. Schools, default first; `primary` = every active class of it is in پایهٴ اول–ششم (a دبستان). */
export async function listDemoSchools(tx: Tx): Promise<DemoSchoolFacts[]> {
  const res = await tx.execute<{ id: string; name: string; is_primary: boolean | null }>(sql`
    select s.id, s.name, bool_and(gl.sequence <= 6) as is_primary
    from tenancy.school s
    left join tenancy.branch b on b.school_id = s.id
    left join tenancy.class_group cg on cg.branch_id = b.id and cg.status = 'active'
    left join tenancy.grade_level gl on gl.id = cg.grade_level_id
    group by s.id, s.name, s.is_default, s.created_at
    order by s.is_default desc, s.created_at, s.name
  `);
  return res.rows.map((r) => ({ id: r.id, name: r.name, primary: r.is_primary === true }));
}

/**
 * Tenant. The accounts the demo login would accept — active, no soft lock, no pending forced change, an active
 * membership and an active person — with the person's name. (The action re-checks all of it, and that the account
 * belongs to no organization off the allow-list.)
 */
export async function listDemoPeople(tx: Tx): Promise<DemoPerson[]> {
  const res = await tx.execute<{ person_id: string; account_id: string; first_name: string; last_name: string }>(sql`
    select p.id as person_id, ua.id as account_id, p.first_name, p.last_name
    from iam.organization_membership m
    join iam.person p on p.id = m.person_id
    join iam.user_account ua on ua.id = m.user_account_id
    where m.status = 'active'
      and p.status = 'active'
      and ua.status = 'active'
      and ua.must_change_password = false
      and (ua.locked_until is null or ua.locked_until <= now())
  `);
  return res.rows.map((r) => ({ personId: r.person_id, accountId: r.account_id, firstName: r.first_name, lastName: r.last_name }));
}

const MANAGER_HATS: ReadonlySet<string> = new Set<DemoManagerHatKey>(["org_admin", "principal", "vice", "counselor"]);

/**
 * Tenant. The manager hats (مدیر سازمان / مدیر مدرسه / معاون / مشاور) of every valid assignment, named by the
 * product's own rule (`roleHatsFor`), each with the school it sits in — null for an organization-wide one.
 */
export async function listDemoManagerHats(tx: Tx): Promise<DemoManagerHat[]> {
  const res = await tx.execute<{ person_id: string; role_code: string; scope_type: string; school_id: string | null; permissions: string[] }>(sql`
    select
      ra.person_id,
      r.code as role_code,
      ra.scope_type,
      coalesce(ra.school_id, b.school_id, cgb.school_id, ob.school_id) as school_id,
      coalesce(array_agg(rp.permission_code) filter (where rp.permission_code is not null), '{}') as permissions
    from iam.role_assignment ra
    join iam.role r on r.id = ra.role_id
    left join iam.role_permission rp on rp.role_id = r.id
    left join tenancy.branch b on b.id = ra.branch_id
    left join tenancy.class_group cg on cg.id = ra.class_group_id
    left join tenancy.branch cgb on cgb.id = cg.branch_id
    left join tenancy.class_offering o on o.id = ra.class_offering_id
    left join tenancy.class_group ocg on ocg.id = o.class_group_id
    left join tenancy.branch ob on ob.id = ocg.branch_id
    where ra.revoked_at is null
      and (ra.valid_from is null or ra.valid_from <= current_date)
      and (ra.valid_to is null or ra.valid_to >= current_date)
      and r.code not in ('teacher', 'student', 'guardian')
    group by ra.id, ra.person_id, r.code, ra.scope_type, ra.school_id, b.school_id, cgb.school_id, ob.school_id
  `);
  const out: DemoManagerHat[] = [];
  for (const r of res.rows) {
    const scopeType = r.scope_type as ScopeType;
    const schoolId = scopeType === "organization" ? null : r.school_id;
    if (scopeType !== "organization" && !schoolId) continue;
    for (const hat of roleHatsFor([{ roleCode: r.role_code, scopeType, permissions: r.permissions }])) {
      if (MANAGER_HATS.has(hat)) out.push({ personId: r.person_id, hat: hat as DemoManagerHatKey, schoolId });
    }
  }
  return out;
}

/** Tenant. What every teacher teaches NOW — the same set as the Home cards (`taughtOfferingsFrom`, ../hats). */
export async function listDemoTeaching(tx: Tx): Promise<DemoTeaching[]> {
  const res = await tx.execute<{ person_id: string; school_id: string; subject_name: string; class_name: string; grade_seq: number }>(sql`
    select distinct stp.person_id, b.school_id, subj.name as subject_name, cg.name as class_name, gl.sequence as grade_seq
    from academic.teacher_assignment ta
    join iam.staff_profile stp on stp.id = ta.staff_profile_id
    join tenancy.class_offering o on o.id = ta.class_offering_id
    join tenancy.class_group cg on cg.id = o.class_group_id
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.subject subj on subj.id = o.subject_id
    join tenancy.grade_level gl on gl.id = cg.grade_level_id
    where ta.valid_to is null
      and o.status <> 'closed'
      and cg.status = 'active'
  `);
  return res.rows.map((r) => ({
    personId: r.person_id,
    schoolId: r.school_id,
    subjectName: r.subject_name,
    className: r.class_name,
    gradeSeq: Number(r.grade_seq),
  }));
}

/** Tenant. Every active student's current class (the latest active enrollment) with its پایه. */
export async function listDemoStudents(tx: Tx): Promise<DemoStudentPlace[]> {
  const res = await tx.execute<{ person_id: string; school_id: string; class_name: string; grade_name: string; grade_seq: number }>(sql`
    select distinct on (sp.person_id)
      sp.person_id, b.school_id, cg.name as class_name, gl.name as grade_name, gl.sequence as grade_seq
    from iam.student_profile sp
    join academic.class_enrollment ce on ce.student_profile_id = sp.id and ce.status = 'active'
    join tenancy.class_group cg on cg.id = ce.class_group_id
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.grade_level gl on gl.id = cg.grade_level_id
    where sp.status = 'active'
    order by sp.person_id, ce.starts_on desc
  `);
  return res.rows.map((r) => ({
    personId: r.person_id,
    schoolId: r.school_id,
    className: r.class_name,
    gradeName: r.grade_name,
    gradeSeq: Number(r.grade_seq),
  }));
}
