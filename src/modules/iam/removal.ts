// iam/removal — «حذف دانش‌آموز» / «حذف از کارکنان»: a SOFT removal of one person, inside the caller's transaction.
// Nothing is deleted but one thing (the last bullet) — work items, attendance, audit, enrollments and assignments stay
// as history; the person only stops being LIVE anywhere:
//   • person.status 'archived' — every people list, picker, roster, recipient query and counter filters on it;
//   • student: active class_enrollment(s) → 'ended', live school_enrollment(s) → 'withdrawn' (both end TODAY in
//     Asia/Tehran), student_profile → 'withdrawn';
//   • staff: every live teacher_assignment ended through `endTeacherAssignment` (its derived `teacher` role is revoked
//     with it, audited there), staff_profile.left_on = today (Tehran);
//   • every role_assignment still live is revoked (manager roles, the student's own `student` marker);
//   • login: membership 'left', user_account 'disabled', every live session revoked, the encrypted initial password
//     of the credentials sheet cleared. The account row and its identifier stay (history; restore is by hand);
//   • OPEN work items somebody else gave them (owner, 2026-10-07): their unfinished assignee row is taken out
//     (`withdrawRemovedAssignee` — the one deletion of the removal; the rows are listed in the audit row) so the
//     giver's «n از m» counts only the people still here; an item whose remaining assignees are all done flips to
//     done. Finished and cancelled items keep them as history.
// One `iam.person.removed` audit row summarises the change (statuses, counts and the ids of the ended rows — no
// secrets). Idempotent: on a person already removed nothing changes and nothing is written (`alreadyRemoved`).
//
// Authorization (`planRemoval`, also the page's show/hide answer through `canRemovePerson`). A removal ends many
// things at once, so it must never be a second door to something the caller could not do one step at a time:
//   1. not yourself (VALIDATION);
//   2. `iam.person.write` through a BROAD assignment — `getPermissionScope`, FORBIDDEN otherwise — and the person
//      inside that scope (`requirePersonInScope`: the admin people rule, NOT_FOUND, no existence oracle);
//   3. `kind` matches the person (a student profile / a staff profile; VALIDATION);
//   4. nobody holding an organization-scoped role: the one مدیر سازمان is managed by code, never from a screen
//      (FORBIDDEN — the same rule as `revokeRoleAssignment`). With an organization holding exactly one, this is also
//      «never the last organization admin»;
//   5. a school-scoped caller removes a person only when every live tie — live school enrollment, active class,
//      primary school, teaching, school/branch/class role — is inside their schools (FORBIDDEN otherwise: another
//      school's ties are that school's, or the organization admin's, to end);
//   6. every live manager role must be one the caller could revoke on /admin/roles (`iam.role_assignment.write` at
//      the role's grant scope; `school_principal` needs the organization — FORBIDDEN): a vice principal cannot
//      unseat the principal by removing them;
//   7. every live teaching must be one the caller could end (`academic.teacher_assignment.write` at its school).
//
// Concurrency (READ COMMITTED; tests/int/concurrency.test.ts runs these races on two real connections). The removal
// takes the person row FOR UPDATE before anything else (`planRemoval`) and holds it until it commits. Every write that
// would make the person live again reads «is this person still here?» only under a lock on that same row, so it waits
// for a removal in flight and then sees `archived`, and a removal that starts later waits for it and ends what it wrote:
//   • FOR SHARE (`lockPersonForShare`, ./repo) in front of the one-person checks — `enrollStudent`, `moveEnrollment`,
//     `assignTeacher` (academic/service), `assignRole`, `createAccountForPerson`, the temporary password and the unlock
//     (`requireAccountInOrg`, ./service). The importer, «افزودن تدریس», the offerings form and the placement all reach
//     the database through these;
//   • FOR KEY SHARE on the recipients of a new work item (the class roster, the named persons — workspace/repo
//     `RecipientReadOptions`): a whole class at once, so the weakest mode that still waits for FOR UPDATE.
// So this lock must stay FOR UPDATE: FOR NO KEY UPDATE would not wait for the KEY SHARE readers, nor they for it.
// Lock order — the same in every transaction, so none waits on another in a circle: person rows → work item rows
// (FOR NO KEY UPDATE; ascending id when several, `withdrawRemovedAssignee`; one in `changeStatus` / `updateWorkItem`)
// → the rows under an item (assignees, inbox entries, transitions). Nothing locks a work item and then a person — and
// a foreign-key check is a lock too: inserting a notification or a transition takes KEY SHARE on the person it names.
// So a write on an existing item takes its actor's and assignees' person rows FOR KEY SHARE (ascending id) BEFORE the
// item (workspace/service `lockItemPeople`) and the removal its actor's before its items; a reopening («بازیابی») then
// reads its assignees' status under those locks (`withdrawArchivedAssignees`).
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { AppError, forbidden, notFound, validation } from "@/lib/errors";
import { classEnrollment, schoolEnrollment, teacherAssignment } from "@/modules/academic/schema";
import { endTeacherAssignment } from "@/modules/academic/service";
import { branch, classGroup, classOffering } from "@/modules/tenancy/schema";
import { withdrawRemovedAssignee } from "@/modules/workspace/service";
import { can, canAtAnyScope } from "./can";
import { revokeAllForUser } from "./repo";
import { authIdentity, organizationMembership, person, role, roleAssignment, staffProfile, studentProfile, userAccount } from "./schema";
import { getPermissionScope, liveSchoolEnrollmentSql, ORG_GRANTED_ROLES, requirePersonInScope, roleAssignmentSchoolId, type IamCtx } from "./service";

export type RemovalKind = "student" | "staff";

export const REMOVAL_MESSAGES = {
  self: "نمی‌توانید خودتان را حذف کنید.",
  orgAdmin: "مدیر سازمان از این بخش حذف نمی‌شود.",
  notStudent: "این شخص دانش‌آموز نیست.",
  notStaff: "این شخص از کارکنان نیست.",
  otherSchool: "این شخص در مدرسهٴ دیگری هم ثبت شده است؛ حذف او فقط با مدیر سازمان ممکن است.",
  role: (roleName: string) => `این همکار نقش «${roleName}» دارد و شما اجازهٴ لغو آن را ندارید.`,
  teaching: "پایان دادن به تدریس این همکار در اختیار شما نیست.",
} as const;

/** Today's date in Asia/Tehran, from the database clock (the stack runs in UTC; Iran has no DST since 1401). */
const tehranToday = (): SQL => sql`(now() at time zone 'Asia/Tehran')::date`;

interface LiveRole {
  id: string;
  roleCode: string;
  roleName: string;
  scopeType: string;
  sourceType: string;
  studentProfileId: string | null;
  /** The school the role lives under (school / branch / class scopes); null for student / family scopes. */
  schoolId: string | null;
}

interface RemovalPlan {
  person: { id: string; firstName: string; lastName: string; status: string };
  student: { id: string; status: string } | null;
  staff: { id: string; leftOn: string | null; schoolId: string | null } | null;
  /** Live teacher assignments with the school of their class. */
  teaching: Array<{ id: string; schoolId: string }>;
  roles: LiveRole[];
}

/**
 * Every guard of the removal (header, 1–7), in an order that leaks nothing: self → permission scope (FORBIDDEN) →
 * person in scope (NOT_FOUND) → kind → organization role → other schools → manager roles → teaching. Reads only;
 * `lock` takes the person row FOR UPDATE first (the real removal), so a double tap serialises on it and the second
 * call sees the first one's result — and so does every door that would bring the person back (header, «Concurrency»).
 */
async function planRemoval(tx: Tx, ctx: IamCtx, personId: string, kind: RemovalKind, lock: boolean): Promise<RemovalPlan> {
  if (personId === ctx.personId) throw validation(undefined, REMOVAL_MESSAGES.self);
  const scope = await getPermissionScope(tx, ctx, "iam.person.write");
  if (lock) {
    const locked = await tx.select({ id: person.id }).from(person).where(eq(person.id, personId)).for("update");
    if (!locked[0]) throw notFound();
  }
  await requirePersonInScope(tx, scope, personId);

  const [p] = await tx.select({ id: person.id, firstName: person.firstName, lastName: person.lastName, status: person.status }).from(person).where(eq(person.id, personId)).limit(1);
  if (!p) throw notFound();
  const [sp] = await tx.select({ id: studentProfile.id, status: studentProfile.status }).from(studentProfile).where(eq(studentProfile.personId, personId)).limit(1);
  const [st] = await tx.select({ id: staffProfile.id, leftOn: staffProfile.leftOn, schoolId: staffProfile.schoolId }).from(staffProfile).where(eq(staffProfile.personId, personId)).limit(1);
  if (kind === "student" && !sp) throw validation(undefined, REMOVAL_MESSAGES.notStudent);
  if (kind === "staff" && !st) throw validation(undefined, REMOVAL_MESSAGES.notStaff);

  const liveRoles = await tx
    .select({
      id: roleAssignment.id,
      roleCode: role.code,
      roleName: role.name,
      scopeType: roleAssignment.scopeType,
      sourceType: roleAssignment.sourceType,
      schoolId: roleAssignment.schoolId,
      branchId: roleAssignment.branchId,
      classGroupId: roleAssignment.classGroupId,
      classOfferingId: roleAssignment.classOfferingId,
      studentProfileId: roleAssignment.studentProfileId,
    })
    .from(roleAssignment)
    .innerJoin(role, eq(role.id, roleAssignment.roleId))
    .where(and(eq(roleAssignment.personId, personId), isNull(roleAssignment.revokedAt)));
  if (liveRoles.some((r) => r.scopeType === "organization")) throw forbidden(REMOVAL_MESSAGES.orgAdmin);
  const roles: LiveRole[] = [];
  for (const r of liveRoles) {
    const schoolId = r.scopeType === "student" || r.scopeType === "family" ? null : await roleAssignmentSchoolId(tx, ctx.orgId, r);
    roles.push({ id: r.id, roleCode: r.roleCode, roleName: r.roleName, scopeType: r.scopeType, sourceType: r.sourceType, studentProfileId: r.studentProfileId, schoolId });
  }

  const teaching = st
    ? await tx
        .select({ id: teacherAssignment.id, schoolId: branch.schoolId })
        .from(teacherAssignment)
        .innerJoin(classOffering, eq(classOffering.id, teacherAssignment.classOfferingId))
        .innerJoin(classGroup, eq(classGroup.id, classOffering.classGroupId))
        .innerJoin(branch, eq(branch.id, classGroup.branchId))
        .where(and(eq(teacherAssignment.staffProfileId, st.id), isNull(teacherAssignment.validTo)))
    : [];

  if (scope.kind === "school") {
    const ties = new Set<string>();
    if (sp) {
      const rows = await tx.execute<{ school_id: string }>(sql`
        select se.school_id from academic.school_enrollment se where se.student_profile_id = ${sp.id} and ${liveSchoolEnrollmentSql("se")}
        union
        select b.school_id from academic.class_enrollment ce
          join tenancy.class_group cg on cg.id = ce.class_group_id
          join tenancy.branch b on b.id = cg.branch_id
        where ce.student_profile_id = ${sp.id} and ce.status = 'active'`);
      for (const r of rows.rows) ties.add(r.school_id);
    }
    if (st?.schoolId && st.leftOn === null) ties.add(st.schoolId);
    for (const t of teaching) ties.add(t.schoolId);
    for (const r of roles) if (r.schoolId) ties.add(r.schoolId);
    if ([...ties].some((s) => !scope.schoolIds.includes(s))) throw forbidden(REMOVAL_MESSAGES.otherSchool);
  }

  for (const r of roles) {
    // A derived teacher role ends with its teaching (below); the student's own marker was granted with the
    // person (`iam.person.write`, `resolveRoleGrant`) and goes with them.
    if (r.sourceType === "teacher_assignment") continue;
    if (r.roleCode === "student" && r.scopeType === "student" && sp && r.studentProfileId === sp.id) continue;
    // The revoke rule of /admin/roles (`revokeRoleAssignment`): `school_principal` at the organization, every other
    // role at its school; a role whose school cannot be named needs the organization-level permission.
    const orgLevel = (ORG_GRANTED_ROLES as readonly string[]).includes(r.roleCode);
    const permitted =
      r.scopeType === "student" || r.scopeType === "family"
        ? canAtAnyScope(ctx.assignments, "iam.role_assignment.write")
        : await can(tx, ctx, "iam.role_assignment.write", orgLevel || !r.schoolId ? undefined : { scopeType: "school", id: r.schoolId });
    if (!permitted) throw forbidden(REMOVAL_MESSAGES.role(r.roleName));
  }
  for (const schoolId of new Set(teaching.map((t) => t.schoolId))) {
    if (!(await can(tx, ctx, "academic.teacher_assignment.write", { scopeType: "school", id: schoolId }))) throw forbidden(REMOVAL_MESSAGES.teaching);
  }

  return {
    person: p,
    student: sp ? { id: sp.id, status: sp.status } : null,
    staff: st ? { id: st.id, leftOn: st.leftOn, schoolId: st.schoolId } : null,
    teaching,
    roles,
  };
}

/**
 * Whether `ctx` may remove this ACTIVE person as `kind` right now — the same guards as `removePerson`, without the
 * row lock and without writing. The person page shows «حذف …» only when this is true (the action re-checks).
 */
export async function canRemovePerson(tx: Tx, ctx: IamCtx, personId: string, kind: RemovalKind): Promise<boolean> {
  try {
    const plan = await planRemoval(tx, ctx, personId, kind, false);
    return plan.person.status === "active";
  } catch (err) {
    if (AppError.is(err)) return false;
    throw err;
  }
}

export interface RemovePersonInput {
  personId: string;
  kind: RemovalKind;
}

export interface RemovePersonResult {
  personId: string;
  kind: RemovalKind;
  /** Nothing was live any more: no row changed, no audit row written. */
  alreadyRemoved: boolean;
  endedClassEnrollments: number;
  endedSchoolEnrollments: number;
  endedTeacherAssignments: number;
  /** Derived teacher roles (ended with their teaching) + every other role that was still live. */
  revokedRoleAssignments: number;
  /** Open work items they were taken out of (their unfinished assignee row deleted). */
  withdrawnWorkItems: number;
  /** Of those, the items that flipped to done because everyone left had finished. */
  completedWorkItems: number;
  revokedSessions: number;
  accountDisabled: boolean;
}

/** The soft removal (header). Every guard runs first (`planRemoval`); then the writes, in one transaction with the caller's. */
export async function removePerson(tx: Tx, ctx: IamCtx, input: RemovePersonInput): Promise<RemovePersonResult> {
  const plan = await planRemoval(tx, ctx, input.personId, input.kind, true);
  const personId = plan.person.id;

  // Teaching first: `endTeacherAssignment` revokes each derived `teacher` role and writes its own audit row.
  let derivedRoles = 0;
  for (const t of plan.teaching) derivedRoles += (await endTeacherAssignment(tx, ctx, { teacherAssignmentId: t.id })).revokedRoleAssignments;
  const revokedRoleIds = (
    await tx
      .update(roleAssignment)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(roleAssignment.personId, personId), isNull(roleAssignment.revokedAt)))
      .returning({ id: roleAssignment.id })
  ).map((r) => r.id);

  // Student: the class and the school end today (never before they started: `starts_on <= ends_on` CHECKs), never later
  // than an end already set.
  let endedClassIds: string[] = [];
  let endedSchoolIds: string[] = [];
  let studentStatus = plan.student?.status ?? null;
  if (plan.student) {
    endedClassIds = (
      await tx
        .update(classEnrollment)
        .set({ status: "ended", endsOn: sql`least(${classEnrollment.endsOn}, greatest(${tehranToday()}, ${classEnrollment.startsOn}))`, changeReason: "admin", changedByPersonId: ctx.personId })
        .where(and(eq(classEnrollment.studentProfileId, plan.student.id), eq(classEnrollment.status, "active")))
        .returning({ id: classEnrollment.id })
    ).map((r) => r.id);
    endedSchoolIds = (
      await tx
        .update(schoolEnrollment)
        .set({ status: "withdrawn", endsOn: sql`least(${schoolEnrollment.endsOn}, greatest(${tehranToday()}, ${schoolEnrollment.startsOn}))`, exitReason: "removed" })
        .where(and(eq(schoolEnrollment.studentProfileId, plan.student.id), liveSchoolEnrollmentSql("academic.school_enrollment")))
        .returning({ id: schoolEnrollment.id })
    ).map((r) => r.id);
    if (studentStatus === "active" || studentStatus === "prospective") {
      await tx.update(studentProfile).set({ status: "withdrawn" }).where(eq(studentProfile.id, plan.student.id));
      studentStatus = "withdrawn";
    }
  }

  // Open work items: out of the giver's count (header). Before the archive below; the order does not matter otherwise.
  const work = await withdrawRemovedAssignee(tx, ctx, personId);

  let staffLeftOn = plan.staff?.leftOn ?? null;
  if (plan.staff && staffLeftOn === null) {
    const [row] = await tx.update(staffProfile).set({ leftOn: tehranToday() }).where(and(eq(staffProfile.id, plan.staff.id), isNull(staffProfile.leftOn))).returning({ leftOn: staffProfile.leftOn });
    staffLeftOn = row?.leftOn ?? null;
  }

  const personChanged = plan.person.status !== "archived";
  if (personChanged) await tx.update(person).set({ status: "archived" }).where(eq(person.id, personId));

  // Login: the membership leaves, the (global) account is disabled, every session dies, the printable initial password goes.
  const [membership] = await tx
    .select({ id: organizationMembership.id, userAccountId: organizationMembership.userAccountId, status: organizationMembership.status })
    .from(organizationMembership)
    .where(eq(organizationMembership.personId, personId))
    .limit(1);
  let membershipChanged = false;
  let accountBefore: string | null = null;
  let accountChanged = false;
  let clearedInitialPassword = false;
  let revokedSessions = 0;
  if (membership) {
    if (membership.status !== "left") {
      await tx.update(organizationMembership).set({ status: "left", leftAt: sql`now()` }).where(eq(organizationMembership.id, membership.id));
      membershipChanged = true;
    }
    // auth_identity before user_account, the order setPassword / resetInitialPassword write them in (no deadlock).
    const cleared = await tx
      .update(authIdentity)
      .set({ initialPasswordEnc: null })
      .where(and(eq(authIdentity.userAccountId, membership.userAccountId), sql`${authIdentity.initialPasswordEnc} is not null`))
      .returning({ id: authIdentity.id });
    clearedInitialPassword = cleared.length > 0;
    const [acct] = await tx.select({ status: userAccount.status }).from(userAccount).where(eq(userAccount.id, membership.userAccountId)).limit(1);
    accountBefore = acct?.status ?? null;
    if (acct && acct.status !== "disabled") {
      await tx.update(userAccount).set({ status: "disabled" }).where(eq(userAccount.id, membership.userAccountId));
      accountChanged = true;
    }
    revokedSessions = await revokeAllForUser(tx, membership.userAccountId);
  }

  const counts = {
    classEnrollments: endedClassIds.length,
    schoolEnrollments: endedSchoolIds.length,
    teacherAssignments: plan.teaching.length,
    roleAssignments: derivedRoles + revokedRoleIds.length,
    sessions: revokedSessions,
    workItems: work.withdrawn.length,
  };
  const changed =
    personChanged ||
    membershipChanged ||
    accountChanged ||
    clearedInitialPassword ||
    studentStatus !== (plan.student?.status ?? null) ||
    staffLeftOn !== (plan.staff?.leftOn ?? null) ||
    Object.values(counts).some((n) => n > 0);
  if (changed) {
    await audit(
      ctx,
      "iam.person.removed",
      { schema: "iam", table: "person", id: personId },
      {
        kind: input.kind,
        personStatus: plan.person.status,
        studentStatus: plan.student?.status ?? null,
        staffLeftOn: plan.staff?.leftOn ?? null,
        membershipStatus: membership?.status ?? null,
        accountStatus: accountBefore,
      },
      {
        kind: input.kind,
        personStatus: "archived",
        studentStatus,
        staffLeftOn,
        membershipStatus: membership ? "left" : null,
        accountStatus: membership && accountBefore !== null ? "disabled" : null,
        counts,
        clearedInitialPassword,
        // The ids a support engineer needs to restore the person by hand (docs/admin.md «حذف دانش‌آموز / همکار»).
        endedClassEnrollmentIds: endedClassIds,
        endedSchoolEnrollmentIds: endedSchoolIds,
        endedTeacherAssignmentIds: plan.teaching.map((t) => t.id),
        revokedRoleAssignmentIds: revokedRoleIds,
        // Open items they were taken out of — a restore re-inserts these assignee rows (role 'assignee', this state).
        withdrawnWorkItemAssignees: work.withdrawn,
        completedWorkItemIds: work.completedWorkItemIds,
      },
      tx,
    );
  }
  return {
    personId,
    kind: input.kind,
    alreadyRemoved: !changed,
    endedClassEnrollments: counts.classEnrollments,
    endedSchoolEnrollments: counts.schoolEnrollments,
    endedTeacherAssignments: counts.teacherAssignments,
    revokedRoleAssignments: counts.roleAssignments,
    withdrawnWorkItems: counts.workItems,
    completedWorkItems: work.completedWorkItemIds.length,
    revokedSessions,
    accountDisabled: accountChanged || accountBefore === "disabled",
  };
}
