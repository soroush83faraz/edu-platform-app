// iam/guardian — «اولیا» (owner, 2026-10-18; docs/decisions.md «اولیا — فاز ۱»): guardian persons, their links to the
// children (iam.guardian_link, migration 0020) and their accounts. Every function is `(tx, ctx, input)` inside the
// caller's tenant transaction; every write is audited in it.
//
// The model. A guardian is a `person` of the organization — ONE person and ONE login per guardian phone, however many
// children (siblings) they have here. Each LIVE link derives one role assignment (`guardian_full`, scope `student` =
// that child, source_type `guardian_relationship`, source_id = the link), so every guardian permission reaches one
// child and nothing above it; the guardian pages additionally require the live link itself (./guardian-views).
// Ending a link revokes its role; when a guardian-only person has no live link left, their access closes
// (membership `left`, account `disabled`, sessions revoked — what a removal does to a login) and a later link opens
// it again with a fresh initial password.
//
// Who the guardian of a phone is (`findGuardianCandidate`, in this order — the account-identifier rules):
//   1. a guardian-only person of THIS organization already holding the phone (own mobile or login) → the same person
//      (a sibling's guardian; one account per phone per organization);
//   2. the phone is the login of an ACTIVE colleague's live account here (a teacher who is also a parent) → the «ولی»
//      role joins that person and account — no second login;
//   3. the phone is ANY other account's login — a student who signs in with the parent's number, a removed person, an
//      account of another organization (invisible here) → NEVER merged: a new guardian person with a generated
//      username `<school code>-v-<student number>` (./guardian-policy); one sentence for all of these, so nothing says
//      which (no oracle beyond what «این شماره قبلاً ثبت شده است» already said);
//   4. a free phone → a new guardian person whose login is the phone.
//
// Authorization (writes: `iam.person.write` through a BROAD assignment — `getPermissionScope`, FORBIDDEN otherwise —
// and the student inside that scope, `requirePersonInScope`, NOT_FOUND; reads: the admin scope). Never yourself (a
// manager is no guardian of their own school's child through their own hands — the D1 rule «nobody grants themselves
// a role»). A school-scoped admin reaches a GUARDIAN only through a child in their scope; whatever would let them act
// AS a person — reading the initial password on a sheet, «تعیین رمز موقت», «رفع قفل», «ساخت حساب», a closed guardian
// access reopened with a new password — needs every live child of that person inside their scope
// (`requireCredentialReach` / `credentialReachSql`: security review 2026-10-19, D1 — the staff pages' account
// operations call it too, so a school's manager cannot sign in as a COLLEAGUE who is a parent at another school), and
// a colleague's account is never touched here (its password belongs to the staff pages). A guardian-only person is
// anchored nowhere in `personInScopeSql`: they appear in no admin people list and no work-item recipient picker
// (workspace `inReach`).
//
// Concurrency (READ COMMITTED, the lock order of ./removal): the STUDENT person rows first (ascending when several),
// then the GUARDIAN person rows (ascending), both FOR NO KEY UPDATE — it waits for a removal (FOR UPDATE), serialises
// two link edits of one student and two of one guardian, and never blocks the FOR KEY SHARE readers (work-item
// recipients, notification FK checks) — then the link, role and account rows. So a removal ending the last link of a
// guardian and a link being added to that guardian run one after the other, and the second reads what the first
// committed: no live link left on a closed account, no account closed under a live link.
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { encryptInitialPassword } from "@/lib/crypto";
import { forbidden, notFound, conflict, validation } from "@/lib/errors";
import { findClassGroup, findSchoolById } from "@/modules/tenancy/repo";
import { pruneGuardianNotifications } from "./guardian-notify";
import { BULK_RELATION, CREDENTIALS_ORG_ADMIN_ONLY, guardianUsernameBase, isGuardianRelation, placeholderGuardianName, type GuardianAccountKind, type GuardianRelation } from "./guardian-policy";
import { generateInitialPassword, hashPassword } from "./password";
import { revokeAllForUser } from "./repo";
import { authIdentity, contactPoint, guardianLink, organizationMembership, person, roleAssignment, userAccount } from "./schema";
import {
  assertSchoolInScope,
  cleanNames,
  cleanPhone,
  createAccountForPerson,
  findSystemRole,
  freeGeneratedUsername,
  getAdminScope,
  getPermissionScope,
  liveSchoolEnrollmentSql,
  MESSAGES,
  personInScopeSql,
  requirePersonInScope,
  resetInitialPassword,
  type AdminScope,
  type IamCtx,
} from "./service";
import { clearRecentFailures } from "./throttle";

export const GUARDIAN_ROLE_CODE = "guardian_full";

export const GUARDIAN_MESSAGES = {
  phoneRequired: "شمارهٴ موبایل ولی را وارد کنید.",
  relationInvalid: "نسبت ولی را انتخاب کنید.",
  self: "نمی‌توانید خودتان را ولیِ دانش‌آموز ثبت کنید؛ از همکار دیگری بخواهید.",
  sameAsStudent: "ولی نمی‌تواند خودِ دانش‌آموز باشد.",
  notStudent: "این شخص دانش‌آموز نیست.",
  /**
   * Acting AS someone with a child the caller does not manage (`requireCredentialReach`) — the same neutral sentence
   * for a guardian and a colleague; it used to say «… فرزندی در مدرسهٴ دیگری هم دارد», which told a school's manager
   * where another school's parent has children.
   */
  orgAdminOnly: CREDENTIALS_ORG_ADMIN_ONLY,
  /** «تعیین رمز موقت» for a colleague's account. */
  staffAccount: "این ولی از همکاران است و با حساب همکاری خودش وارد می‌شود؛ رمز او از صفحهٴ کارکنان تعیین می‌شود.",
  noAccount: "این ولی حساب کاربری ندارد.",
  closed: "دسترسی این ولی بسته است؛ برای باز شدن دوباره، او را به فرزندش وصل کنید.",
} as const;

const fieldError = (field: string, message: string) => validation({ fieldErrors: { [field]: [message] } }, message);

/** Column references below are code constants — still, keep them boring (same rule as ./service). */
const COLUMN_REF_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,2}$/;
function columnRef(column: string): SQL {
  if (!COLUMN_REF_RE.test(column)) throw new Error(`invalid column reference: ${column}`);
  return sql.raw(column);
}

/** SQL «the person in `personColumn` is a GUARDIAN-ONLY person»: neither a student nor a colleague (any staff profile). */
export function guardianOnlySql(personColumn: string): SQL {
  const p = columnRef(personColumn);
  return sql`(not exists (select 1 from iam.student_profile gsp where gsp.person_id = ${p})
    and not exists (select 1 from iam.staff_profile gst where gst.person_id = ${p}))`;
}

/**
 * SQL «every LIVE child of the person in `personColumn` is inside `scope`» (the admin people rule on each child) — the
 * condition for acting AS that person (security review 2026-10-19, D1): reading an initial password on a sheet,
 * «تعیین رمز موقت», «رفع قفل», «ساخت حساب کاربری», reopening a closed guardian login. True for the organization scope
 * and for anybody who is nobody's guardian; a colleague of school A who is the parent of a school-B student is false
 * for school A's manager. The list queries apply it row by row; the single-person paths call `requireCredentialReach`.
 */
export function credentialReachSql(scope: AdminScope, personColumn: string): SQL {
  if (scope.kind === "organization") return sql`true`;
  const p = columnRef(personColumn);
  return sql`not exists (
    select 1 from iam.guardian_link wgl
    join iam.student_profile wsp on wsp.id = wgl.student_profile_id
    where wgl.guardian_person_id = ${p} and wgl.status = 'active'
      and not ${personInScopeSql(scope, "wsp.person_id")})`;
}

/**
 * SQL «the guardian in `personColumn` is KNOWN to `scope`» — the caller's schools already manage this person, so a
 * name typed there may replace theirs (security review 2026-10-19, D2b) and the «اولیا» card, the sheet and the
 * outcome of «افزودن ولی» may show their stored name, login and colleague status (D3):
 *   - the organization scope;
 *   - a COLLEAGUE inside the scope (`personInScopeSql` — they are on the caller's staff list anyway);
 *   - a GUARDIAN-ONLY person every one of whose links, live OR ENDED, is to a student of the scope — by the admin
 *     people rule, or, for a student who left every school (removed, graduated), by the school they were at last.
 * Not known: a parent another school registered — even after that school's link ended and the account closed, when
 * the next school's link reopens it — or a colleague of another school. Their stored name stays theirs (the school
 * that typed it, and the organization admin, keep reading it) and a school that merely typed their phone learns
 * nothing about them. Stricter than `credentialReachSql` (live links only) on purpose: reach is about what the caller
 * could read AS the person today; knowing is about whose data the person's record already is.
 */
export function guardianKnownSql(scope: AdminScope, personColumn: string): SQL {
  if (scope.kind === "organization") return sql`true`;
  const p = columnRef(personColumn);
  const ids = sql`${sql.param(scope.schoolIds, undefined)}::uuid[]`;
  return sql`(case when ${guardianOnlySql(personColumn)} then not exists (
      select 1 from iam.guardian_link kgl
      join iam.student_profile ksp on ksp.id = kgl.student_profile_id
      where kgl.guardian_person_id = ${p}
        and not (
          ${personInScopeSql(scope, "ksp.person_id")}
          or (not exists (select 1 from academic.school_enrollment kse where kse.student_profile_id = ksp.id and ${liveSchoolEnrollmentSql("kse")})
              and (select lse.school_id from academic.school_enrollment lse where lse.student_profile_id = ksp.id
                   order by lse.starts_on desc, lse.created_at desc limit 1) = any(${ids}))))
    else ${personInScopeSql(scope, personColumn)} end)`;
}

/**
 * The ONE gate in front of every path that sets, resets, reveals or unlocks a person's credential, creates their login
 * or re-enables it (security review 2026-10-19, D1): `adminResetInitialPassword` / `adminUnlockAccount` (./admin), the
 * person's credentials sheet and «ساخت حساب کاربری» (src/lib/admin), «تعیین رمز موقت» of a guardian and a closed
 * guardian access reopened (below). Callers have checked the person's scope first (NOT_FOUND outside it). FORBIDDEN —
 * one neutral sentence, `GUARDIAN_MESSAGES.orgAdminOnly` — unless `credentialReachSql` holds: otherwise a school's
 * manager could sign in as a colleague, or a parent, of another school's student and read that child. The person row
 * is taken FOR SHARE first, so a guardian link being added to them at this moment (FOR NO KEY UPDATE, «Concurrency»
 * above) is waited for and then seen. Organization scope: nothing to check, no lock.
 */
export async function requireCredentialReach(tx: Tx, scope: AdminScope, personId: string): Promise<void> {
  if (scope.kind === "organization") return;
  const [locked] = await tx.select({ id: person.id }).from(person).where(eq(person.id, personId)).for("share");
  if (!locked) throw notFound();
  const res = await tx.execute<{ ok: boolean }>(sql`select ${credentialReachSql(scope, "p.id")} as ok from iam.person p where p.id = ${personId}::uuid`);
  if (res.rows[0]?.ok !== true) throw forbidden(GUARDIAN_MESSAGES.orgAdminOnly);
}

// ---------------------------------------------------------------------------------------------------------------
// facts and locks
// ---------------------------------------------------------------------------------------------------------------

interface StudentFacts {
  studentProfileId: string;
  personId: string;
  firstName: string;
  lastName: string;
  studentNumber: string;
  personStatus: string;
  profileStatus: string;
  /** The school of the active class, else of the live school enrollment (the username prefix). */
  schoolId: string | null;
}

async function studentFacts(tx: Tx, studentProfileId: string): Promise<StudentFacts | null> {
  const res = await tx.execute<{
    id: string;
    person_id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    person_status: string;
    profile_status: string;
    school_id: string | null;
  }>(sql`
    select sp.id, sp.person_id, p.first_name, p.last_name, sp.student_number, p.status as person_status, sp.status as profile_status,
      coalesce(
        (select b.school_id from academic.class_enrollment ce
           join tenancy.class_group cg on cg.id = ce.class_group_id
           join tenancy.branch b on b.id = cg.branch_id
         where ce.student_profile_id = sp.id and ce.status = 'active'
         order by ce.starts_on desc limit 1),
        (select se.school_id from academic.school_enrollment se
         where se.student_profile_id = sp.id and ${liveSchoolEnrollmentSql("se")}
         order by se.created_at desc limit 1)
      ) as school_id
    from iam.student_profile sp
    join iam.person p on p.id = sp.person_id
    where sp.id = ${studentProfileId}::uuid
    limit 1`);
  const r = res.rows[0];
  return r
    ? {
        studentProfileId: r.id,
        personId: r.person_id,
        firstName: r.first_name,
        lastName: r.last_name,
        studentNumber: r.student_number,
        personStatus: r.person_status,
        profileStatus: r.profile_status,
        schoolId: r.school_id,
      }
    : null;
}

/** FOR NO KEY UPDATE on person rows, ascending id (the guardian lock order above). Already-held locks are no-ops. */
async function lockPersons(tx: Tx, personIds: readonly string[]): Promise<void> {
  const ids = [...new Set(personIds)].sort();
  if (ids.length === 0) return;
  await tx.select({ id: person.id }).from(person).where(inArray(person.id, ids)).orderBy(asc(person.id)).for("no key update");
}

/**
 * The student a guardian write is about, locked and live: the profile exists (NOT_FOUND), its person row is locked
 * (FOR NO KEY UPDATE), the person is inside `scope` (NOT_FOUND — another school's student must look nonexistent) and,
 * read under the lock, still active — a removed student never gets a new guardian (CONFLICT «این شخص حذف شده است.»).
 */
async function requireLiveStudent(tx: Tx, scope: AdminScope, studentProfileId: string): Promise<StudentFacts> {
  const before = await studentFacts(tx, studentProfileId);
  if (!before) throw notFound();
  await lockPersons(tx, [before.personId]);
  await requirePersonInScope(tx, scope, before.personId);
  const s = await studentFacts(tx, studentProfileId);
  if (!s) throw notFound();
  if (s.personStatus !== "active" || s.profileStatus !== "active") throw conflict(MESSAGES.personRemoved);
  return s;
}

async function schoolCodeOf(tx: Tx, schoolId: string | null): Promise<string> {
  const sch = schoolId ? await findSchoolById(tx, schoolId) : null;
  if (!sch) throw fieldError("phone", MESSAGES.schoolRequired);
  return sch.code;
}

// ---------------------------------------------------------------------------------------------------------------
// who is the guardian of a phone
// ---------------------------------------------------------------------------------------------------------------

export type GuardianCandidate = { kind: "guardian"; personId: string } | { kind: "staff"; personId: string } | { kind: "taken" } | { kind: "free" };

/** The four account-identifier rules of the module header, in order. `phone` is normalized E.164. Reads only. */
export async function findGuardianCandidate(tx: Tx, phone: string): Promise<GuardianCandidate> {
  const known = await tx.execute<{ id: string }>(sql`
    select p.id
    from iam.person p
    where p.status = 'active'
      and exists (select 1 from iam.guardian_link gl where gl.guardian_person_id = p.id)
      and ${guardianOnlySql("p.id")}
      and (
        exists (select 1 from iam.contact_point cp where cp.person_id = p.id and cp.kind = 'mobile' and cp.label is null and cp.value = ${phone})
        or exists (select 1 from iam.organization_membership m join iam.user_account ua on ua.id = m.user_account_id
                   where m.person_id = p.id and (ua.login_identifier = ${phone} or ua.phone_e164 = ${phone}))
      )
    order by p.created_at, p.id
    limit 1`);
  if (known.rows[0]) return { kind: "guardian", personId: known.rows[0].id };

  // The account is a GLOBAL row; its membership is read under RLS, so another organization's simply is not there.
  const [acct] = await tx
    .select({ id: userAccount.id, status: userAccount.status })
    .from(userAccount)
    .where(or(eq(userAccount.loginIdentifier, phone), eq(userAccount.phoneE164, phone)))
    .limit(1);
  if (!acct) return { kind: "free" };
  const colleague = await tx.execute<{ person_id: string }>(sql`
    select m.person_id
    from iam.organization_membership m
    join iam.person p on p.id = m.person_id
    join iam.staff_profile st on st.person_id = p.id
    where m.user_account_id = ${acct.id}::uuid
      and m.status = 'active'
      and p.status = 'active'
      and st.left_on is null
      and not exists (select 1 from iam.student_profile sp where sp.person_id = p.id)
    limit 1`);
  if (acct.status !== "disabled" && colleague.rows[0]) return { kind: "staff", personId: colleague.rows[0].person_id };
  return { kind: "taken" };
}

interface EnsuredGuardian {
  personId: string;
  kind: Exclude<GuardianAccountKind, "reopened">;
  account: { loginIdentifier: string; initialPassword: string } | null;
}

/**
 * The guardian person of `phone` (rules 1–4): an existing one, a colleague, or a NEW guardian person (names
 * normalized, own mobile contact point, audited) with its account — the phone as login, or the generated username of
 * `child` when the phone is taken.
 */
async function ensureGuardianPerson(
  tx: Tx,
  ctx: IamCtx,
  input: { phone: string; names: { firstName: string; lastName: string }; child: StudentFacts },
): Promise<EnsuredGuardian> {
  const cand = await findGuardianCandidate(tx, input.phone);
  if (cand.kind === "guardian") return { personId: cand.personId, kind: "existing", account: null };
  if (cand.kind === "staff") return { personId: cand.personId, kind: "staff", account: null };

  // The username is decided before anything is written (a student without a school has no prefix).
  const identifier =
    cand.kind === "free"
      ? { loginIdentifier: input.phone, phoneE164: input.phone }
      : await freeGeneratedUsername(tx, guardianUsernameBase(await schoolCodeOf(tx, input.child.schoolId), input.child.studentNumber));
  const [p] = await tx
    .insert(person)
    .values({ organizationId: ctx.orgId, firstName: input.names.firstName, lastName: input.names.lastName, status: "active" })
    .returning({ id: person.id });
  await tx.insert(contactPoint).values({ organizationId: ctx.orgId, personId: p.id, kind: "mobile", value: input.phone, isPrimary: true });
  await audit(ctx, "iam.person.created", { schema: "iam", table: "person", id: p.id }, null, { ...input.names, kind: "guardian", forStudentProfileId: input.child.studentProfileId }, tx);
  const account = await createAccountForPerson(tx, ctx, { personId: p.id, identifier, field: "phone" });
  return { personId: p.id, kind: cand.kind === "free" ? "new_phone" : "new_username", account: { loginIdentifier: account.loginIdentifier, initialPassword: account.initialPassword } };
}

// ---------------------------------------------------------------------------------------------------------------
// links
// ---------------------------------------------------------------------------------------------------------------

interface LinkOutcome {
  linkId: string;
  alreadyLinked: boolean;
  /** The guardian's closed access was opened again — the new initial password, returned ONCE. */
  reopened: { loginIdentifier: string; initialPassword: string } | null;
  /** The caller's schools already know this guardian (`guardianKnownSql`) — what the outcome may say about them (D3). */
  known: boolean;
}

/** One person's `guardianKnownSql`. */
async function isGuardianKnown(tx: Tx, scope: AdminScope, personId: string): Promise<boolean> {
  if (scope.kind === "organization") return true;
  const res = await tx.execute<{ known: boolean }>(sql`select ${guardianKnownSql(scope, "p.id")} as known from iam.person p where p.id = ${personId}::uuid`);
  return res.rows[0]?.known === true;
}

/**
 * Links a guardian person to a live student (both already locked): never yourself, never the student; the guardian
 * must be an active person. An existing live link keeps its row (a changed relation is updated, audited); a new one
 * is primary when the student has no live primary guardian yet, and carries its derived `guardian_full` assignment.
 * A guardian-only person whose access had closed is opened again (`reopenGuardianAccess`) — for a caller who may act
 * as them (`scope`). Whether the caller's schools already know the guardian is read under the guardian's lock (the
 * new link, of a student in scope, changes nothing about it).
 */
async function linkGuardian(tx: Tx, ctx: IamCtx, scope: AdminScope, student: StudentFacts, guardianPersonId: string, relation: GuardianRelation): Promise<LinkOutcome> {
  if (guardianPersonId === ctx.personId) throw forbidden(GUARDIAN_MESSAGES.self);
  if (guardianPersonId === student.personId) throw fieldError("phone", GUARDIAN_MESSAGES.sameAsStudent);
  await lockPersons(tx, [guardianPersonId]);
  const [g] = await tx.select({ status: person.status }).from(person).where(eq(person.id, guardianPersonId)).limit(1);
  if (!g) throw notFound();
  if (g.status !== "active") throw conflict(MESSAGES.personRemoved);
  const known = await isGuardianKnown(tx, scope, guardianPersonId);

  const [live] = await tx
    .select({ id: guardianLink.id, relation: guardianLink.relation })
    .from(guardianLink)
    .where(and(eq(guardianLink.guardianPersonId, guardianPersonId), eq(guardianLink.studentProfileId, student.studentProfileId), eq(guardianLink.status, "active")))
    .limit(1);
  if (live) {
    if (live.relation !== relation) {
      await tx.update(guardianLink).set({ relation }).where(eq(guardianLink.id, live.id));
      await audit(ctx, "iam.guardian_link.updated", { schema: "iam", table: "guardian_link", id: live.id }, { relation: live.relation }, { relation }, tx);
    }
    return { linkId: live.id, alreadyLinked: true, reopened: await reopenGuardianAccess(tx, ctx, scope, student, guardianPersonId, known), known };
  }

  const [primary] = await tx
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .where(and(eq(guardianLink.studentProfileId, student.studentProfileId), eq(guardianLink.status, "active"), eq(guardianLink.isPrimary, true)))
    .limit(1);
  const [link] = await tx
    .insert(guardianLink)
    .values({ organizationId: ctx.orgId, guardianPersonId, studentProfileId: student.studentProfileId, relation, isPrimary: !primary, status: "active" })
    .returning({ id: guardianLink.id, isPrimary: guardianLink.isPrimary });
  const tpl = await findSystemRole(tx, GUARDIAN_ROLE_CODE);
  const [ra] = await tx
    .insert(roleAssignment)
    .values({
      organizationId: ctx.orgId,
      personId: guardianPersonId,
      roleId: tpl.id,
      scopeType: "student",
      studentProfileId: student.studentProfileId,
      sourceType: "guardian_relationship",
      sourceId: link.id,
      grantedByPersonId: ctx.personId,
    })
    .returning({ id: roleAssignment.id });
  await audit(
    ctx,
    "iam.guardian_link.created",
    { schema: "iam", table: "guardian_link", id: link.id },
    null,
    { guardianPersonId, studentProfileId: student.studentProfileId, relation, isPrimary: link.isPrimary, roleAssignmentId: ra.id },
    tx,
  );
  return { linkId: link.id, alreadyLinked: false, reopened: await reopenGuardianAccess(tx, ctx, scope, student, guardianPersonId, known), known };
}

/** The live derived `guardian_full` assignments of these links, revoked; their ids. */
async function revokeLinkRoles(tx: Tx, linkIds: readonly string[]): Promise<string[]> {
  if (linkIds.length === 0) return [];
  const rows = await tx
    .update(roleAssignment)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(roleAssignment.sourceType, "guardian_relationship"), inArray(roleAssignment.sourceId, [...linkIds]), isNull(roleAssignment.revokedAt)))
    .returning({ id: roleAssignment.id });
  return rows.map((r) => r.id);
}

interface EndedLinks {
  endedLinkIds: string[];
  revokedRoleAssignmentIds: string[];
  /** The ended children's notifications deleted from their guardians' bells (`pruneGuardianNotifications`). */
  withdrawnNotifications: number;
}

/**
 * Ends live links (status `archived`, `archived_at`) and their roles, and takes the ended children's notifications out
 * of those guardians' bells (D2); the ids of what changed. The guardian rows are locked by the caller.
 */
async function endLinks(tx: Tx, linkIds: readonly string[]): Promise<EndedLinks> {
  if (linkIds.length === 0) return { endedLinkIds: [], revokedRoleAssignmentIds: [], withdrawnNotifications: 0 };
  const ended = await tx
    .update(guardianLink)
    .set({ status: "archived", archivedAt: sql`now()` })
    .where(and(inArray(guardianLink.id, [...linkIds]), eq(guardianLink.status, "active")))
    .returning({ id: guardianLink.id, guardianPersonId: guardianLink.guardianPersonId });
  const endedLinkIds = ended.map((r) => r.id);
  const revokedRoleAssignmentIds = await revokeLinkRoles(tx, endedLinkIds);
  const withdrawnNotifications = await pruneGuardianNotifications(
    tx,
    ended.map((r) => r.guardianPersonId),
  );
  return { endedLinkIds, revokedRoleAssignmentIds, withdrawnNotifications };
}

// ---------------------------------------------------------------------------------------------------------------
// access: closing and reopening a guardian-only login
// ---------------------------------------------------------------------------------------------------------------

async function isGuardianOnly(tx: Tx, personId: string): Promise<boolean> {
  const res = await tx.execute<{ ok: boolean }>(sql`select ${guardianOnlySql("p.id")} as ok from iam.person p where p.id = ${personId}::uuid`);
  return res.rows[0]?.ok === true;
}

/**
 * A guardian-only person (locked by the caller) with no live link left: their login closes like a removal's —
 * membership `left`, the printable initial password cleared, the account `disabled`, every session revoked, and the
 * bell emptied of guardian notifications (D2: whoever reopens the account later must not find a former child's name
 * there — `endLinks` pruned them already; this keeps «closed» meaning «clean» for any caller) — audited as
 * `iam.guardian.access_closed`. A colleague keeps their account (only the derived role went with the link), and so
 * does a guardian who still has a child here. Returns whether anything closed.
 */
async function closeGuardianAccessIfOrphaned(tx: Tx, ctx: IamCtx, guardianPersonId: string): Promise<boolean> {
  const [liveLeft] = await tx
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .where(and(eq(guardianLink.guardianPersonId, guardianPersonId), eq(guardianLink.status, "active")))
    .limit(1);
  if (liveLeft) return false;
  if (!(await isGuardianOnly(tx, guardianPersonId))) return false;
  const [m] = await tx
    .select({ id: organizationMembership.id, status: organizationMembership.status, userAccountId: organizationMembership.userAccountId })
    .from(organizationMembership)
    .where(eq(organizationMembership.personId, guardianPersonId))
    .limit(1);
  if (!m) return false;
  if (m.status !== "left") await tx.update(organizationMembership).set({ status: "left", leftAt: sql`now()` }).where(eq(organizationMembership.id, m.id));
  // auth_identity before user_account — the order removal and the password writers use (no deadlock).
  const cleared = await tx
    .update(authIdentity)
    .set({ initialPasswordEnc: null })
    .where(and(eq(authIdentity.userAccountId, m.userAccountId), sql`${authIdentity.initialPasswordEnc} is not null`))
    .returning({ id: authIdentity.id });
  const [acct] = await tx.select({ status: userAccount.status }).from(userAccount).where(eq(userAccount.id, m.userAccountId)).limit(1);
  if (acct && acct.status !== "disabled") await tx.update(userAccount).set({ status: "disabled" }).where(eq(userAccount.id, m.userAccountId));
  const revokedSessions = await revokeAllForUser(tx, m.userAccountId);
  const withdrawnNotifications = await pruneGuardianNotifications(tx, [guardianPersonId]);
  if (m.status === "left" && acct?.status === "disabled" && cleared.length === 0 && revokedSessions === 0 && withdrawnNotifications === 0) return false;
  await audit(
    ctx,
    "iam.guardian.access_closed",
    { schema: "iam", table: "person", id: guardianPersonId },
    { membershipStatus: m.status, accountStatus: acct?.status ?? null },
    { membershipStatus: "left", accountStatus: "disabled", revokedSessions, clearedInitialPassword: cleared.length > 0, withdrawnNotifications },
    tx,
  );
  return true;
}

/**
 * The reverse, when a guardian-only person (locked by the caller) gets a live link again while their access is closed:
 * membership `active`, the account `active` with a NEW initial password (`must_change_password`, encrypted copy for the
 * sheet, its identifier's recent failures cleared) — the old password is nobody's to reuse after the school closed
 * the account. The new password goes to the caller, so this is acting AS the guardian: every live child of theirs —
 * the new link included — must be inside the caller's scope (`requireCredentialReach`, FORBIDDEN otherwise; a closed
 * account normally has no live link left, so this refuses only an account disabled under live links of another
 * school). The bell keeps only the live children's notifications (D2 — the former children's are pruned again here, in
 * case any outlived the close). When the caller's schools do not know the guardian (`known` false: another school
 * registered them) and their login is a USERNAME, it was generated from THAT school's code and child
 * (`<code>-v-<number>`) — printing it on this school's slip would tell them both, so the login is renewed from the new
 * child, exactly as if created here (D3); a phone login is the number the caller typed and stays. Audited as
 * `iam.guardian.access_reopened` (no secret in it). Null when nothing was closed.
 */
async function reopenGuardianAccess(
  tx: Tx,
  ctx: IamCtx,
  scope: AdminScope,
  child: StudentFacts,
  guardianPersonId: string,
  known: boolean,
): Promise<{ loginIdentifier: string; initialPassword: string } | null> {
  const [m] = await tx
    .select({
      id: organizationMembership.id,
      status: organizationMembership.status,
      userAccountId: organizationMembership.userAccountId,
      accountStatus: userAccount.status,
      loginIdentifier: userAccount.loginIdentifier,
      phoneE164: userAccount.phoneE164,
    })
    .from(organizationMembership)
    .innerJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
    .where(eq(organizationMembership.personId, guardianPersonId))
    .limit(1);
  if (!m || (m.status === "active" && m.accountStatus !== "disabled")) return null;
  if (!(await isGuardianOnly(tx, guardianPersonId))) return null; // a colleague's login is never reopened from here
  await requireCredentialReach(tx, scope, guardianPersonId);
  let loginIdentifier = m.loginIdentifier;
  const loginRenewed = !known && m.phoneE164 === null;
  if (loginRenewed) {
    const next = await freeGeneratedUsername(tx, guardianUsernameBase(await schoolCodeOf(tx, child.schoolId), child.studentNumber));
    await tx.update(userAccount).set({ loginIdentifier: next.loginIdentifier }).where(eq(userAccount.id, m.userAccountId));
    loginIdentifier = next.loginIdentifier;
  }
  const initialPassword = generateInitialPassword();
  const secretHash = await hashPassword(initialPassword);
  const updated = await tx
    .update(authIdentity)
    .set({ secretHash, initialPasswordEnc: encryptInitialPassword(initialPassword) })
    .where(and(eq(authIdentity.userAccountId, m.userAccountId), eq(authIdentity.provider, "password")))
    .returning({ id: authIdentity.id });
  if (!updated[0]) await tx.insert(authIdentity).values({ userAccountId: m.userAccountId, provider: "password", secretHash, initialPasswordEnc: encryptInitialPassword(initialPassword) });
  await tx.update(userAccount).set({ status: "active", mustChangePassword: true, passwordChangedAt: null, failedLoginCount: 0, lockedUntil: null }).where(eq(userAccount.id, m.userAccountId));
  await clearRecentFailures(tx, loginIdentifier);
  await tx.update(organizationMembership).set({ status: "active", leftAt: null }).where(eq(organizationMembership.id, m.id));
  const withdrawnNotifications = await pruneGuardianNotifications(tx, [guardianPersonId]);
  await audit(
    ctx,
    "iam.guardian.access_reopened",
    { schema: "iam", table: "person", id: guardianPersonId },
    { membershipStatus: m.status, accountStatus: m.accountStatus },
    { membershipStatus: "active", accountStatus: "active", userAccountId: m.userAccountId, withdrawnNotifications, loginRenewed },
    tx,
  );
  return { loginIdentifier, initialPassword };
}

// ---------------------------------------------------------------------------------------------------------------
// the student page's «اولیا» card
// ---------------------------------------------------------------------------------------------------------------

export interface AddGuardianInput {
  studentProfileId: string;
  firstName: string;
  lastName: string;
  phone: string;
  relation: string;
}

export interface AddGuardianResult {
  linkId: string;
  guardianPersonId: string;
  /** `linked` (the neutral sentence) for an existing person the caller's schools do not know — D3. */
  accountKind: GuardianAccountKind;
  /** The guardian was linked to this student already (the relation may have been updated). */
  alreadyLinked: boolean;
  /** The typed name replaced the guardian's stored one (an existing guardian the caller's schools already know — D2b). */
  renamed: boolean;
  /** Plaintext, returned ONCE: a new account, or a reopened one. Null otherwise. */
  account: { loginIdentifier: string; initialPassword: string } | null;
}

/**
 * «افزودن ولی» on the student page: name + phone + relation. Scope and permission first (header); the student
 * locked, in scope and live; the guardian found or created by the phone rules; then the link. Adding a phone that
 * is ALREADY a guardian here links that same person (one account across siblings) and, when the caller's schools
 * already know them (`guardianKnownSql`: every link of theirs, live or ended, to a student of the scope), replaces
 * their stored name with the typed one — the way a bulk placeholder («ولیِ لیلا …») gets its real name. A name another
 * school stored is never overwritten (D2b — not even when this link reopens that school's closed account); the typed
 * name then only names a brand-new person. A colleague's name is the staff pages' to change.
 */
export async function addGuardian(tx: Tx, ctx: IamCtx, input: AddGuardianInput): Promise<AddGuardianResult> {
  const scope = await getPermissionScope(tx, ctx, "iam.person.write");
  const names = cleanNames({ firstName: input.firstName, lastName: input.lastName });
  const phone = cleanPhone(input.phone, "phone");
  if (!phone) throw fieldError("phone", GUARDIAN_MESSAGES.phoneRequired);
  if (!isGuardianRelation(input.relation)) throw fieldError("relation", GUARDIAN_MESSAGES.relationInvalid);
  const student = await requireLiveStudent(tx, scope, input.studentProfileId);

  const ensured = await ensureGuardianPerson(tx, ctx, { phone, names, child: student });
  const outcome = await linkGuardian(tx, ctx, scope, student, ensured.personId, input.relation);

  // D2b: the typed name replaces the stored one only for a guardian the caller's schools already know (every link,
  // live or ended, theirs) — never the name another school stored, not even through a reopened account.
  let renamed = false;
  if (ensured.kind === "existing") {
    const res = await tx.execute<{ first_name: string; last_name: string; known: boolean }>(sql`
      select p.first_name, p.last_name, ${guardianKnownSql(scope, "p.id")} as known
      from iam.person p where p.id = ${ensured.personId}::uuid`);
    const g = res.rows[0];
    if (g && g.known && (g.first_name !== names.firstName || g.last_name !== names.lastName)) {
      await tx.update(person).set(names).where(eq(person.id, ensured.personId));
      await audit(ctx, "iam.person.updated", { schema: "iam", table: "person", id: ensured.personId }, { firstName: g.first_name, lastName: g.last_name }, { ...names, kind: "guardian" }, tx);
      renamed = true;
    }
  }
  // D3: a person the caller's schools do not know is linked without a word about them (`GUARDIAN_ACCOUNT_NOTES.linked`).
  const kind: GuardianAccountKind = outcome.reopened ? "reopened" : ensured.kind;
  return {
    linkId: outcome.linkId,
    guardianPersonId: ensured.personId,
    accountKind: outcome.known ? kind : "linked",
    alreadyLinked: outcome.alreadyLinked,
    renamed,
    account: ensured.account ?? outcome.reopened,
  };
}

/**
 * «حذف از اولیا»: ends ONE live link (and its derived role) of a student in the caller's scope; the guardian's access
 * closes when that was their last child here. Idempotent on an already-ended link (`alreadyEnded`, nothing written).
 */
export async function unlinkGuardian(tx: Tx, ctx: IamCtx, input: { linkId: string }): Promise<{ alreadyEnded: boolean; accessClosed: boolean }> {
  const scope = await getPermissionScope(tx, ctx, "iam.person.write");
  const [link] = await tx
    .select({ id: guardianLink.id, guardianPersonId: guardianLink.guardianPersonId, studentProfileId: guardianLink.studentProfileId, relation: guardianLink.relation, status: guardianLink.status })
    .from(guardianLink)
    .where(eq(guardianLink.id, input.linkId))
    .limit(1);
  if (!link) throw notFound();
  const facts = await studentFacts(tx, link.studentProfileId);
  if (!facts) throw notFound();
  await lockPersons(tx, [facts.personId]);
  await requirePersonInScope(tx, scope, facts.personId);
  await lockPersons(tx, [link.guardianPersonId]);
  const { endedLinkIds, revokedRoleAssignmentIds, withdrawnNotifications } = await endLinks(tx, [link.id]);
  if (endedLinkIds.length === 0) return { alreadyEnded: true, accessClosed: false };
  const accessClosed = await closeGuardianAccessIfOrphaned(tx, ctx, link.guardianPersonId);
  await audit(
    ctx,
    "iam.guardian_link.ended",
    { schema: "iam", table: "guardian_link", id: link.id },
    { status: "active" },
    { status: "archived", guardianPersonId: link.guardianPersonId, studentProfileId: link.studentProfileId, relation: link.relation, revokedRoleAssignmentIds, accessClosed, withdrawnNotifications },
    tx,
  );
  return { alreadyEnded: false, accessClosed };
}

/**
 * «تعیین رمز موقت» of a guardian from the student's card: the link must be live and the student in the caller's scope
 * (NOT_FOUND), the guardian guardian-only (a colleague's account belongs to the staff pages — FORBIDDEN) and every live
 * child of theirs inside the caller's scope (`requireCredentialReach`, FORBIDDEN otherwise: the new password would let
 * the caller sign in as a parent of another school's student — it locks the guardian row FOR SHARE first, so a link to
 * another school's child being added meanwhile is waited for); then the account service's own reset (sessions revoked,
 * audited). The plaintext is returned ONCE.
 */
export async function resetGuardianPassword(tx: Tx, ctx: IamCtx, input: { linkId: string }): Promise<{ loginIdentifier: string; initialPassword: string }> {
  const scope = await getPermissionScope(tx, ctx, "iam.account.reset_password");
  const [link] = await tx
    .select({ guardianPersonId: guardianLink.guardianPersonId, studentProfileId: guardianLink.studentProfileId })
    .from(guardianLink)
    .where(and(eq(guardianLink.id, input.linkId), eq(guardianLink.status, "active")))
    .limit(1);
  if (!link) throw notFound();
  const facts = await studentFacts(tx, link.studentProfileId);
  if (!facts) throw notFound();
  await requirePersonInScope(tx, scope, facts.personId);
  if (!(await isGuardianOnly(tx, link.guardianPersonId))) throw forbidden(GUARDIAN_MESSAGES.staffAccount);
  await requireCredentialReach(tx, scope, link.guardianPersonId);
  const [acct] = await tx
    .select({ userAccountId: organizationMembership.userAccountId, loginIdentifier: userAccount.loginIdentifier })
    .from(organizationMembership)
    .innerJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
    .where(eq(organizationMembership.personId, link.guardianPersonId))
    .limit(1);
  if (!acct) throw notFound(GUARDIAN_MESSAGES.noAccount);
  const out = await resetInitialPassword(tx, ctx, { userAccountId: acct.userAccountId });
  return { loginIdentifier: acct.loginIdentifier, initialPassword: out.initialPassword };
}

export interface GuardianRow {
  linkId: string;
  guardianPersonId: string;
  /** The stored name of a guardian the caller's schools know (`known`); otherwise «ولیِ <this student>» (D3). */
  firstName: string;
  lastName: string;
  relation: GuardianRelation;
  isPrimary: boolean;
  /**
   * The number this link is about: the guardian's own mobile (contact point), else their login's phone — for a
   * guardian the caller does not know, the login's phone first (the number that was typed for this student; a
   * colleague's other numbers are not the caller's to read).
   */
  phone: string | null;
  /** Login and its state: only for a guardian the caller knows or may act as (`manageable`); null otherwise. */
  loginIdentifier: string | null;
  accountStatus: string | null;
  membershipStatus: string | null;
  mustChangePassword: boolean | null;
  /** A colleague: they sign in with their own staff account (managed on the staff pages). Never said of a stranger. */
  isStaff: boolean;
  /** The caller's schools already know this guardian (`guardianKnownSql`): their name, login and status are shown. */
  known: boolean;
  /** A guardian-only account all of whose live children are in the caller's scope — «تعیین رمز موقت» is the caller's. */
  manageable: boolean;
}

/**
 * The «اولیا» card of a student (admin scope, NOT_FOUND outside it): the LIVE links, primary first, with what the
 * card shows of each guardian's login. No password, ever. Security review 2026-10-19, D3 — a phone number must not
 * reveal who a parent is: a guardian the caller's schools do not already know (another school's parent, a colleague
 * of another school) is listed with the generic «ولیِ <this student>», the number of this link, the relation and
 * «حذف از اولیا» — never their stored name, login, account state or colleague status; the masked values are not even
 * read out of the database.
 */
export async function listGuardiansOfStudent(tx: Tx, ctx: IamCtx, studentPersonId: string): Promise<GuardianRow[]> {
  const scope = await getAdminScope(tx, ctx);
  const student = await requirePersonInScope(tx, scope, studentPersonId);
  const res = await tx.execute<{
    link_id: string;
    guardian_person_id: string;
    known: boolean;
    guardian_only: boolean;
    reach: boolean;
    first_name: string | null;
    last_name: string | null;
    relation: string;
    is_primary: boolean;
    phone: string | null;
    login_identifier: string | null;
    account_status: string | null;
    membership_status: string | null;
    must_change_password: boolean | null;
  }>(sql`
    select gl.id as link_id, gl.guardian_person_id, k.known, k.guardian_only, k.reach,
      case when k.known then p.first_name end as first_name,
      case when k.known then p.last_name end as last_name,
      gl.relation, gl.is_primary,
      case when k.known then coalesce(cpv.value, ua.phone_e164) else coalesce(ua.phone_e164, cpv.value) end as phone,
      case when k.known or (k.guardian_only and k.reach) then ua.login_identifier end as login_identifier,
      case when k.known or (k.guardian_only and k.reach) then ua.status end as account_status,
      case when k.known or (k.guardian_only and k.reach) then m.status end as membership_status,
      case when k.known or (k.guardian_only and k.reach) then ua.must_change_password end as must_change_password
    from iam.guardian_link gl
    join iam.student_profile sp on sp.id = gl.student_profile_id
    join iam.person p on p.id = gl.guardian_person_id
    left join iam.organization_membership m on m.person_id = p.id
    left join iam.user_account ua on ua.id = m.user_account_id
    left join lateral (
      select cp.value from iam.contact_point cp where cp.person_id = p.id and cp.kind = 'mobile' and cp.label is null order by cp.is_primary desc, cp.created_at limit 1
    ) cpv on true
    cross join lateral (
      select ${guardianKnownSql(scope, "p.id")} as known, ${guardianOnlySql("p.id")} as guardian_only, ${credentialReachSql(scope, "p.id")} as reach
    ) k
    where sp.person_id = ${studentPersonId}::uuid and gl.status = 'active'
    order by gl.is_primary desc, gl.created_at, gl.id`);
  const generic = placeholderGuardianName(student);
  return res.rows.map((r) => ({
    linkId: r.link_id,
    guardianPersonId: r.guardian_person_id,
    firstName: r.known && r.first_name !== null ? r.first_name : generic.firstName,
    lastName: r.known && r.last_name !== null ? r.last_name : generic.lastName,
    relation: isGuardianRelation(r.relation) ? r.relation : "other",
    isPrimary: r.is_primary,
    phone: r.phone,
    loginIdentifier: r.login_identifier,
    accountStatus: r.account_status,
    membershipStatus: r.membership_status,
    mustChangePassword: r.must_change_password,
    isStaff: r.known && !r.guardian_only,
    known: r.known,
    manageable: r.guardian_only && r.reach && r.login_identifier !== null,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// the class page's «ساخت حساب اولیا» and its sheet
// ---------------------------------------------------------------------------------------------------------------

export type BulkOutcome = "created" | "linked" | "already" | "staff" | "no_phone" | "invalid_phone";

export interface BulkGuardiansResult {
  students: number;
  /** New guardian accounts (phone or username logins). */
  createdAccounts: number;
  /** Of those, generated usernames (the phone was someone else's login). */
  usernameAccounts: number;
  /** Closed guardian logins opened again (a new initial password each) — of guardians the caller's schools know (D3). */
  reopenedAccounts: number;
  /** New links (to a new, an existing or a colleague's account). */
  linked: number;
  /** Students already linked to the guardian of their «ولی» phone (nothing written for them). */
  alreadyLinked: number;
  /** Links that went to the account of a colleague the caller's schools know (D3: another school's stays «linked»). */
  staffLinked: number;
  noPhone: number;
  invalidPhone: number;
  /** The «ولی» phone is the caller's own login — never their own guardian link. */
  skippedSelf: number;
}

/**
 * «ساخت حساب اولیا» on the class page: for every active student of the class with a «ولی» phone (the student form's
 * contact point), the guardian of that phone is found or created (the four rules) and linked as «سرپرست», primary
 * when the student has none. Idempotent — a second run links nothing and creates nothing — and siblings in the class
 * share one guardian. Locks: every student row of the roster first (ascending), then every EXISTING guardian person
 * the phones lead to (ascending), then the writes (module header «Concurrency»). One `iam.guardian.bulk_created` row
 * summarises the run (each person, account and link has its own row too). A phone that a concurrent run turned into a
 * new account between our lookup and our insert fails the whole run with CONFLICT; running it again is the remedy.
 */
export async function bulkCreateClassGuardians(tx: Tx, ctx: IamCtx, input: { classGroupId: string }): Promise<BulkGuardiansResult> {
  const scope = await getPermissionScope(tx, ctx, "iam.person.write");
  const cg = await findClassGroup(tx, input.classGroupId);
  if (!cg) throw notFound();
  assertSchoolInScope(scope, cg.schoolId);

  const roster = await tx.execute<{ student_profile_id: string; person_id: string; phone: string | null }>(sql`
    select sp.id as student_profile_id, sp.person_id,
      (select cp.value from iam.contact_point cp where cp.person_id = sp.person_id and cp.kind = 'mobile' and cp.label = 'ولی'
       order by cp.is_primary desc, cp.created_at limit 1) as phone
    from academic.class_enrollment ce
    join iam.student_profile sp on sp.id = ce.student_profile_id
    join iam.person p on p.id = sp.person_id
    where ce.class_group_id = ${cg.id}::uuid and ce.status = 'active' and sp.status = 'active' and p.status = 'active'
      and ${personInScopeSql(scope, "sp.person_id")}
    order by p.last_name, p.first_name, sp.id`);
  const result: BulkGuardiansResult = {
    students: roster.rows.length,
    createdAccounts: 0,
    usernameAccounts: 0,
    reopenedAccounts: 0,
    linked: 0,
    alreadyLinked: 0,
    staffLinked: 0,
    noPhone: 0,
    invalidPhone: 0,
    skippedSelf: 0,
  };
  await lockPersons(
    tx,
    roster.rows.map((r) => r.person_id),
  );

  const wanted: Array<{ studentProfileId: string; phone: string }> = [];
  for (const r of roster.rows) {
    if (!r.phone) {
      result.noPhone++;
      continue;
    }
    let phone: string | null = null;
    try {
      phone = cleanPhone(r.phone, "phone");
    } catch {
      phone = null;
    }
    if (!phone) {
      result.invalidPhone++;
      continue;
    }
    wanted.push({ studentProfileId: r.student_profile_id, phone });
  }
  // Existing guardians and colleagues these phones lead to, locked in ascending order before any write.
  const existing: string[] = [];
  for (const phone of new Set(wanted.map((w) => w.phone))) {
    const cand = await findGuardianCandidate(tx, phone);
    if (cand.kind === "guardian" || cand.kind === "staff") existing.push(cand.personId);
  }
  await lockPersons(tx, existing);

  for (const w of wanted) {
    const student = await studentFacts(tx, w.studentProfileId);
    if (!student || student.personStatus !== "active" || student.profileStatus !== "active") continue;
    const ensured = await ensureGuardianPerson(tx, ctx, { phone: w.phone, names: placeholderGuardianName(student), child: student });
    if (ensured.personId === ctx.personId) {
      result.skippedSelf++;
      continue;
    }
    const outcome = await linkGuardian(tx, ctx, scope, student, ensured.personId, BULK_RELATION);
    if (ensured.account) {
      result.createdAccounts++;
      if (ensured.kind === "new_username") result.usernameAccounts++;
    }
    // D3: «… به حساب همکار» / «… دوباره باز شد» only of guardians the caller's schools know — a one-student class
    // must not turn the summary into an oracle for «whose number is this?»; any other person is just «linked».
    if (outcome.reopened && outcome.known) result.reopenedAccounts++;
    if (outcome.alreadyLinked) result.alreadyLinked++;
    else {
      result.linked++;
      if (ensured.kind === "staff" && outcome.known) result.staffLinked++;
    }
  }
  await audit(ctx, "iam.guardian.bulk_created", { schema: "tenancy", table: "class_group", id: cg.id }, null, { ...result }, tx);
  return result;
}

export interface GuardianCredentialRow {
  guardianPersonId: string;
  /** The stored name of a guardian the caller's schools know; otherwise «ولیِ <first child here>» (D3 — the slip then prints no name line). */
  firstName: string;
  lastName: string;
  /** The children IN THIS CLASS, «لیلا نیک‌خواه» each. */
  children: string[];
  /**
   * Null for a guardian the caller neither knows nor may act as (D3: a username another school generated would name
   * that school and a child of it): the slip tells the parent to use the account they already have.
   */
  loginIdentifier: string | null;
  /** Still encrypted (decrypted right before rendering); null when the caller may not read it or it is gone. */
  initialPasswordEnc: string | null;
  mustChangePassword: boolean;
  /** A colleague's account (of a colleague the caller knows): the slip says to sign in with their own staff login. */
  isStaff: boolean;
  /** The caller's schools already know this guardian (`guardianKnownSql`). */
  known: boolean;
}

/**
 * «برگه‌های ورود اولیا» of a class (admin scope; the class's school in scope, else NOT_FOUND): one slip per guardian
 * with a live link to an active student of the class. The encrypted initial password is read ONLY for a guardian-only
 * account still on it whose every live child is in the caller's scope (`credentialReachSql`) — never a colleague's,
 * never one that would let a school's manager sign in as a parent of another school's student. A guardian the
 * caller's schools do not know (D3) gets a slip with neither their stored name nor — unless the caller may act as
 * them — their login; the masked values are not read out of the database.
 */
export async function listClassGuardianCredentials(tx: Tx, ctx: IamCtx, classGroupId: string): Promise<{ className: string; schoolName: string; rows: GuardianCredentialRow[] }> {
  // The sheet reveals passwords: the scope of the permission that resets them (the class credentials sheet's gate).
  const scope = await getPermissionScope(tx, ctx, "iam.account.reset_password");
  const cg = await findClassGroup(tx, classGroupId);
  if (!cg) throw notFound();
  assertSchoolInScope(scope, cg.schoolId);
  const sch = await findSchoolById(tx, cg.schoolId);
  const res = await tx.execute<{
    guardian_person_id: string;
    known: boolean;
    first_name: string | null;
    last_name: string | null;
    child_first_name: string;
    child_last_name: string;
    children: string[];
    login_identifier: string | null;
    must_change_password: boolean;
    is_staff: boolean;
    enc: string | null;
  }>(sql`
    select g.id as guardian_person_id, k.known,
      case when k.known then g.first_name end as first_name,
      case when k.known then g.last_name end as last_name,
      (array_agg(sp_person.first_name order by sp_person.last_name, sp_person.first_name))[1] as child_first_name,
      (array_agg(sp_person.last_name order by sp_person.last_name, sp_person.first_name))[1] as child_last_name,
      array_agg(sp_person.first_name || ' ' || sp_person.last_name order by sp_person.last_name, sp_person.first_name) as children,
      case when k.known or (k.guardian_only and k.reach) then ua.login_identifier end as login_identifier,
      ua.must_change_password,
      (k.known and not k.guardian_only) as is_staff,
      case when k.guardian_only and k.reach and ua.must_change_password
        then (select ai.initial_password_enc from iam.auth_identity ai where ai.user_account_id = ua.id and ai.provider = 'password')
        else null end as enc
    from iam.guardian_link gl
    join iam.student_profile sp on sp.id = gl.student_profile_id
    join iam.person sp_person on sp_person.id = sp.person_id
    join academic.class_enrollment ce on ce.student_profile_id = sp.id and ce.status = 'active' and ce.class_group_id = ${cg.id}::uuid
    join iam.person g on g.id = gl.guardian_person_id
    join iam.organization_membership m on m.person_id = g.id and m.status = 'active'
    join iam.user_account ua on ua.id = m.user_account_id and ua.status <> 'disabled'
    cross join lateral (
      select ${guardianKnownSql(scope, "g.id")} as known, ${guardianOnlySql("g.id")} as guardian_only, ${credentialReachSql(scope, "g.id")} as reach
    ) k
    where gl.status = 'active' and sp.status = 'active' and sp_person.status = 'active' and g.status = 'active'
    group by g.id, g.first_name, g.last_name, ua.id, ua.login_identifier, ua.must_change_password, k.known, k.guardian_only, k.reach
    order by g.last_name, g.first_name, g.id`);
  return {
    className: cg.name,
    schoolName: sch?.name ?? "",
    rows: res.rows.map((r) => {
      const generic = placeholderGuardianName({ firstName: r.child_first_name, lastName: r.child_last_name });
      return {
        guardianPersonId: r.guardian_person_id,
        firstName: r.known && r.first_name !== null ? r.first_name : generic.firstName,
        lastName: r.known && r.last_name !== null ? r.last_name : generic.lastName,
        children: r.children,
        loginIdentifier: r.login_identifier,
        initialPasswordEnc: r.enc,
        mustChangePassword: r.must_change_password,
        isStaff: r.is_staff,
        known: r.known,
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// removal (src/modules/iam/removal.ts)
// ---------------------------------------------------------------------------------------------------------------

export interface EndedGuardianLinks extends EndedLinks {
  /** Guardian-only persons whose access closed because this was their last child here. */
  closedGuardianPersonIds: string[];
}

/**
 * A STUDENT is being removed (its person row is already FOR UPDATE — ./removal): every live link of theirs ends with
 * its derived role and the child's notifications in those guardians' bells (D2), and each guardian left without a
 * live child here loses their login (`closeGuardianAccessIfOrphaned`, each audited). The guardian rows are locked in
 * ascending order, after the student's (the lock order above).
 */
export async function endGuardianLinksOfStudent(tx: Tx, ctx: IamCtx, studentProfileId: string): Promise<EndedGuardianLinks> {
  const live = await tx
    .select({ id: guardianLink.id, guardianPersonId: guardianLink.guardianPersonId })
    .from(guardianLink)
    .where(and(eq(guardianLink.studentProfileId, studentProfileId), eq(guardianLink.status, "active")));
  if (live.length === 0) return { endedLinkIds: [], revokedRoleAssignmentIds: [], withdrawnNotifications: 0, closedGuardianPersonIds: [] };
  const guardians = [...new Set(live.map((l) => l.guardianPersonId))].sort();
  await lockPersons(tx, guardians);
  const ended = await endLinks(
    tx,
    live.map((l) => l.id),
  );
  const closedGuardianPersonIds: string[] = [];
  for (const g of guardians) if (await closeGuardianAccessIfOrphaned(tx, ctx, g)) closedGuardianPersonIds.push(g);
  return { ...ended, closedGuardianPersonIds };
}

/**
 * A COLLEAGUE who is also a guardian is being removed (their person row is FOR UPDATE; the removal revokes every role
 * of theirs and disables their login itself): their own live guardian links end too, so no live link points at a
 * removed person (and their bell drops those children's rows). The children's rows are not locked — a link's end
 * needs nothing of theirs.
 */
export async function endGuardianLinksOfGuardian(tx: Tx, guardianPersonId: string): Promise<EndedLinks> {
  const live = await tx
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .where(and(eq(guardianLink.guardianPersonId, guardianPersonId), eq(guardianLink.status, "active")));
  return endLinks(
    tx,
    live.map((l) => l.id),
  );
}
