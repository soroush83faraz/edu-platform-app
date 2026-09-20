// Read model of the people pages (/admin/students, /admin/staff, /admin/people/[id], rosters, credentials).
// Every query runs under RLS inside the admin's transaction and is narrowed by the admin scope (personInScope).
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Tx } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { classEnrollment, schoolEnrollment, teacherAssignment } from "@/modules/academic/schema";
import { authIdentity, contactPoint, organizationMembership, person, role, roleAssignment, staffProfile, studentProfile, userAccount } from "@/modules/iam/schema";
import { assertSchoolInScope, type AdminScope } from "@/modules/iam/service";
import { findClassGroup } from "@/modules/tenancy/repo";
import { academicYear, branch, classGroup, classOffering, gradeLevel, school, subject } from "@/modules/tenancy/schema";
import { roleLabel } from "./labels";
import { personInScope } from "./overview";

export interface AccountFacts {
  userAccountId: string;
  loginIdentifier: string;
  status: string;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  failedLoginCount: number;
  lastLoginAt: Date | null;
  hasInitialPassword: boolean;
  /** `locked_until` is in the future (temporary lock from the throttle). */
  isLocked: boolean;
}

const accountSelect = {
  userAccountId: userAccount.id,
  loginIdentifier: userAccount.loginIdentifier,
  status: userAccount.status,
  mustChangePassword: userAccount.mustChangePassword,
  lockedUntil: userAccount.lockedUntil,
  failedLoginCount: userAccount.failedLoginCount,
  lastLoginAt: userAccount.lastLoginAt,
  hasInitialPassword: sql<boolean>`coalesce(${authIdentity.initialPasswordEnc} is not null, false)`,
  isLocked: sql<boolean>`coalesce(${userAccount.lockedUntil} > now(), false)`,
};

export interface StudentListRow {
  personId: string;
  firstName: string;
  lastName: string;
  studentNumber: string;
  className: string | null;
  classGroupId: string | null;
  schoolName: string | null;
  loginIdentifier: string | null;
  mustChangePassword: boolean | null;
  accountStatus: string | null;
}

export interface StudentListOptions {
  q: string;
  page: number;
  pageSize: number;
  /** Only accounts still on their initial password. */
  pending?: boolean;
  /** Only students without an active class enrollment. */
  noClass?: boolean;
  classGroupId?: string;
}

function faLike(column: SQL | AnyPgColumn, q: string): SQL | undefined {
  const t = q.trim();
  return t ? sql`${column} ilike '%' || app.fa_norm(${t}) || '%'` : undefined;
}

/** Students in scope with their active class and account state. Search = name (fa_norm) or student number. */
export async function listStudents(tx: Tx, scope: AdminScope, opts: StudentListOptions): Promise<{ rows: StudentListRow[]; total: number }> {
  const activeCe = tx.$with("active_ce").as(
    tx
      .select({ studentProfileId: classEnrollment.studentProfileId, classGroupId: classEnrollment.classGroupId })
      .from(classEnrollment)
      .where(eq(classEnrollment.status, "active")),
  );
  const nameOrNumber = opts.q.trim() ? sql`(${faLike(person.searchText, opts.q)} or ${studentProfile.studentNumber} ilike '%' || ${opts.q.trim()} || '%')` : undefined;
  const where = and(
    eq(person.status, "active"),
    eq(studentProfile.status, "active"),
    personInScope(scope, "iam.person.id"),
    nameOrNumber,
    opts.pending ? eq(userAccount.mustChangePassword, true) : undefined,
    opts.noClass ? isNull(activeCe.classGroupId) : undefined,
    opts.classGroupId ? eq(activeCe.classGroupId, opts.classGroupId) : undefined,
  );
  const base = tx
    .with(activeCe)
    .select({
      personId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      studentNumber: studentProfile.studentNumber,
      className: classGroup.name,
      classGroupId: classGroup.id,
      schoolName: school.name,
      loginIdentifier: userAccount.loginIdentifier,
      mustChangePassword: userAccount.mustChangePassword,
      accountStatus: userAccount.status,
    })
    .from(person)
    .innerJoin(studentProfile, eq(studentProfile.personId, person.id))
    .leftJoin(activeCe, eq(activeCe.studentProfileId, studentProfile.id))
    .leftJoin(classGroup, eq(classGroup.id, activeCe.classGroupId))
    .leftJoin(branch, eq(branch.id, classGroup.branchId))
    .leftJoin(school, eq(school.id, branch.schoolId))
    .leftJoin(organizationMembership, eq(organizationMembership.personId, person.id))
    .leftJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
    .where(where)
    .orderBy(asc(person.lastName), asc(person.firstName));
  const rows = await base.limit(opts.pageSize).offset((Math.max(1, opts.page) - 1) * opts.pageSize);
  const [{ n }] = await tx
    .with(activeCe)
    .select({ n: sql<number>`count(*)::int` })
    .from(person)
    .innerJoin(studentProfile, eq(studentProfile.personId, person.id))
    .leftJoin(activeCe, eq(activeCe.studentProfileId, studentProfile.id))
    .leftJoin(organizationMembership, eq(organizationMembership.personId, person.id))
    .leftJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
    .where(where);
  return { rows, total: n };
}

export interface StaffListRow {
  personId: string;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  loginIdentifier: string | null;
  mustChangePassword: boolean | null;
  accountStatus: string | null;
  /** Manual roles, e.g. «مدیر مدرسه — دبیرستان دخترانه». */
  roles: string[];
  teaching: number;
}

export { roleLabel };

export async function listStaff(tx: Tx, scope: AdminScope, opts: { q: string; page: number; pageSize: number }): Promise<{ rows: StaffListRow[]; total: number }> {
  const where = and(eq(person.status, "active"), isNull(staffProfile.leftOn), personInScope(scope, "iam.person.id"), faLike(person.searchText, opts.q));
  const rows = await tx
    .select({
      personId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      employeeNumber: staffProfile.employeeNumber,
      loginIdentifier: userAccount.loginIdentifier,
      mustChangePassword: userAccount.mustChangePassword,
      accountStatus: userAccount.status,
      roles: sql<string[]>`coalesce((select array_agg(r.code || '|' || coalesce(s.name, '') order by r.code) from iam.role_assignment ra join iam.role r on r.id = ra.role_id left join tenancy.school s on s.id = ra.school_id
        where ra.person_id = ${person.id} and ra.revoked_at is null and ra.source_type = 'manual'), '{}')`,
      teaching: sql<number>`(select count(*)::int from academic.teacher_assignment ta join iam.staff_profile sp2 on sp2.id = ta.staff_profile_id where sp2.person_id = ${person.id} and ta.valid_to is null)`,
    })
    .from(person)
    .innerJoin(staffProfile, eq(staffProfile.personId, person.id))
    .leftJoin(organizationMembership, eq(organizationMembership.personId, person.id))
    .leftJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
    .where(where)
    .orderBy(asc(person.lastName), asc(person.firstName))
    .limit(opts.pageSize)
    .offset((Math.max(1, opts.page) - 1) * opts.pageSize);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(person).innerJoin(staffProfile, eq(staffProfile.personId, person.id)).where(where);
  return {
    rows: rows.map((r) => ({
      ...r,
      roles: r.roles.map((x) => {
        const [code, schoolName] = x.split("|");
        return schoolName ? `${roleLabel(code)} — ${schoolName}` : roleLabel(code);
      }),
    })),
    total: n,
  };
}

export interface PersonDetail {
  id: string;
  firstName: string;
  lastName: string;
  gender: string | null;
  externalRef: string | null;
  status: string;
  kind: "student" | "staff" | "person";
  student: { studentProfileId: string; studentNumber: string; status: string } | null;
  staff: { staffProfileId: string; employeeNumber: string | null; employmentType: string | null } | null;
  contactPhone: string | null;
  guardianPhone: string | null;
  account: AccountFacts | null;
  enrollment: { classEnrollmentId: string; classGroupId: string; className: string; schoolId: string; schoolName: string; gradeName: string; yearName: string } | null;
  roles: Array<{ roleAssignmentId: string; roleCode: string; roleName: string; scopeType: string; schoolId: string | null; schoolName: string | null; sourceType: string }>;
  teaching: Array<{ teacherAssignmentId: string; classOfferingId: string; className: string; subjectName: string }>;
  /** Schools the person is anchored to (scope); used to pick the credential sheet's school name. */
  schoolIds: string[];
}

export async function getPersonDetail(tx: Tx, scope: AdminScope, personId: string): Promise<PersonDetail> {
  const rows = await tx
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      gender: person.gender,
      externalRef: person.externalRef,
      status: person.status,
      inScope: sql<boolean>`${personInScope(scope, "iam.person.id")}`,
    })
    .from(person)
    .where(eq(person.id, personId))
    .limit(1);
  const p = rows[0];
  if (!p || !p.inScope) throw notFound();

  const [sp] = await tx.select({ id: studentProfile.id, studentNumber: studentProfile.studentNumber, status: studentProfile.status }).from(studentProfile).where(eq(studentProfile.personId, personId)).limit(1);
  const [st] = await tx.select({ id: staffProfile.id, employeeNumber: staffProfile.employeeNumber, employmentType: staffProfile.employmentType }).from(staffProfile).where(eq(staffProfile.personId, personId)).limit(1);
  const phones = await tx.select({ value: contactPoint.value, label: contactPoint.label }).from(contactPoint).where(and(eq(contactPoint.personId, personId), eq(contactPoint.kind, "mobile")));
  const [acct] = await tx
    .select(accountSelect)
    .from(organizationMembership)
    .innerJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
    .leftJoin(authIdentity, and(eq(authIdentity.userAccountId, userAccount.id), eq(authIdentity.provider, "password")))
    .where(eq(organizationMembership.personId, personId))
    .limit(1);

  let enrollment: PersonDetail["enrollment"] = null;
  if (sp) {
    const [ce] = await tx
      .select({
        classEnrollmentId: classEnrollment.id,
        classGroupId: classGroup.id,
        className: classGroup.name,
        schoolId: school.id,
        schoolName: school.name,
        gradeName: gradeLevel.name,
        yearName: academicYear.name,
      })
      .from(classEnrollment)
      .innerJoin(classGroup, eq(classGroup.id, classEnrollment.classGroupId))
      .innerJoin(branch, eq(branch.id, classGroup.branchId))
      .innerJoin(school, eq(school.id, branch.schoolId))
      .innerJoin(gradeLevel, eq(gradeLevel.id, classGroup.gradeLevelId))
      .innerJoin(academicYear, eq(academicYear.id, classGroup.academicYearId))
      .where(and(eq(classEnrollment.studentProfileId, sp.id), eq(classEnrollment.status, "active")))
      .limit(1);
    enrollment = ce ?? null;
  }

  const roles = await tx
    .select({
      roleAssignmentId: roleAssignment.id,
      roleCode: role.code,
      roleName: role.name,
      scopeType: roleAssignment.scopeType,
      schoolId: roleAssignment.schoolId,
      schoolName: school.name,
      sourceType: roleAssignment.sourceType,
    })
    .from(roleAssignment)
    .innerJoin(role, eq(role.id, roleAssignment.roleId))
    .leftJoin(school, eq(school.id, roleAssignment.schoolId))
    .where(and(eq(roleAssignment.personId, personId), isNull(roleAssignment.revokedAt), sql`${roleAssignment.scopeType} in ('organization', 'school', 'branch')`))
    .orderBy(asc(role.code));

  const teaching = st
    ? await tx
        .select({ teacherAssignmentId: teacherAssignment.id, classOfferingId: classOffering.id, className: classGroup.name, subjectName: subject.name })
        .from(teacherAssignment)
        .innerJoin(classOffering, eq(classOffering.id, teacherAssignment.classOfferingId))
        .innerJoin(classGroup, eq(classGroup.id, classOffering.classGroupId))
        .innerJoin(subject, eq(subject.id, classOffering.subjectId))
        .where(and(eq(teacherAssignment.staffProfileId, st.id), isNull(teacherAssignment.validTo)))
        .orderBy(asc(classGroup.name), asc(subject.name))
    : [];

  const schoolIds = new Set<string>();
  if (enrollment) schoolIds.add(enrollment.schoolId);
  for (const r of roles) if (r.schoolId) schoolIds.add(r.schoolId);
  const se = sp ? await tx.select({ schoolId: schoolEnrollment.schoolId }).from(schoolEnrollment).where(eq(schoolEnrollment.studentProfileId, sp.id)) : [];
  for (const r of se) schoolIds.add(r.schoolId);

  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    gender: p.gender,
    externalRef: p.externalRef,
    status: p.status,
    kind: sp ? "student" : st ? "staff" : "person",
    student: sp ? { studentProfileId: sp.id, studentNumber: sp.studentNumber, status: sp.status } : null,
    staff: st ? { staffProfileId: st.id, employeeNumber: st.employeeNumber, employmentType: st.employmentType } : null,
    contactPhone: phones.find((x) => !x.label)?.value ?? null,
    guardianPhone: phones.find((x) => x.label === "ولی")?.value ?? null,
    account: acct ?? null,
    enrollment,
    roles,
    teaching,
    schoolIds: [...schoolIds],
  };
}

export interface CredentialRow {
  personId: string;
  firstName: string;
  lastName: string;
  studentNumber: string | null;
  className: string | null;
  loginIdentifier: string;
  /** Still encrypted — the page decrypts right before rendering. */
  initialPasswordEnc: string | null;
  mustChangePassword: boolean;
}

/** Everyone with an account in a class (active enrollments), for the credentials sheet. */
export async function listClassCredentials(tx: Tx, scope: AdminScope, classGroupId: string): Promise<{ className: string; schoolName: string; rows: CredentialRow[] }> {
  const cg = await findClassGroup(tx, classGroupId);
  if (!cg) throw notFound();
  assertSchoolInScope(scope, cg.schoolId);
  const [sch] = await tx.select({ name: school.name }).from(school).where(eq(school.id, cg.schoolId)).limit(1);
  const rows = await tx
    .select({
      personId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      studentNumber: studentProfile.studentNumber,
      className: classGroup.name,
      loginIdentifier: userAccount.loginIdentifier,
      initialPasswordEnc: authIdentity.initialPasswordEnc,
      mustChangePassword: userAccount.mustChangePassword,
    })
    .from(classEnrollment)
    .innerJoin(studentProfile, eq(studentProfile.id, classEnrollment.studentProfileId))
    .innerJoin(person, eq(person.id, studentProfile.personId))
    .innerJoin(classGroup, eq(classGroup.id, classEnrollment.classGroupId))
    .innerJoin(organizationMembership, eq(organizationMembership.personId, person.id))
    .innerJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
    .leftJoin(authIdentity, and(eq(authIdentity.userAccountId, userAccount.id), eq(authIdentity.provider, "password")))
    .where(and(eq(classEnrollment.classGroupId, classGroupId), eq(classEnrollment.status, "active")))
    .orderBy(asc(person.lastName), asc(person.firstName));
  return { className: cg.name, schoolName: sch?.name ?? "", rows };
}

export async function personCredential(tx: Tx, scope: AdminScope, personId: string): Promise<{ schoolName: string; row: CredentialRow }> {
  const d = await getPersonDetail(tx, scope, personId);
  if (!d.account) throw notFound("این فرد حساب کاربری ندارد.");
  const [ident] = await tx.select({ enc: authIdentity.initialPasswordEnc }).from(authIdentity).where(and(eq(authIdentity.userAccountId, d.account.userAccountId), eq(authIdentity.provider, "password"))).limit(1);
  let schoolName = d.enrollment?.schoolName ?? "";
  if (!schoolName && d.schoolIds[0]) {
    const [s] = await tx.select({ name: school.name }).from(school).where(eq(school.id, d.schoolIds[0])).limit(1);
    schoolName = s?.name ?? "";
  }
  return {
    schoolName,
    row: {
      personId: d.id,
      firstName: d.firstName,
      lastName: d.lastName,
      studentNumber: d.student?.studentNumber ?? null,
      className: d.enrollment?.className ?? null,
      loginIdentifier: d.account.loginIdentifier,
      initialPasswordEnc: ident?.enc ?? null,
      mustChangePassword: d.account.mustChangePassword,
    },
  };
}

/** Class options for the student form / move dialog: active classes of the current years in scope. */
export async function classOptionsInScope(tx: Tx, scope: AdminScope): Promise<Array<{ value: string; label: string; group?: string; schoolId: string }>> {
  const rows = await tx
    .select({ id: classGroup.id, name: classGroup.name, gradeName: gradeLevel.name, schoolId: school.id, schoolName: school.name, yearName: academicYear.name, isCurrent: academicYear.isCurrent })
    .from(classGroup)
    .innerJoin(branch, eq(branch.id, classGroup.branchId))
    .innerJoin(school, eq(school.id, branch.schoolId))
    .innerJoin(gradeLevel, eq(gradeLevel.id, classGroup.gradeLevelId))
    .innerJoin(academicYear, eq(academicYear.id, classGroup.academicYearId))
    .where(and(eq(classGroup.status, "active"), scope.kind === "organization" ? undefined : sql`${school.id} = any(${sql.param(scope.schoolIds, undefined)}::uuid[])`))
    .orderBy(asc(school.name), asc(gradeLevel.sequence), asc(classGroup.name));
  const schools = new Set(rows.map((r) => r.schoolId));
  const many = schools.size > 1;
  return rows.map((r) => ({
    value: r.id,
    label: `${r.name} (${r.gradeName}${r.isCurrent ? "" : ` — ${r.yearName}`})`,
    group: many ? r.schoolName : undefined,
    schoolId: r.schoolId,
  }));
}
