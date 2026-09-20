// Seed. Runs as app_owner (MIGRATION_DATABASE_URL) with its OWN pool â€” never through withTenant/withoutTenant.
//
//   pnpm seed            = tsx scripts/seed.ts --catalog            (idempotent; run after every migrate)
//   pnpm seed:demo       = tsx scripts/seed.ts --catalog --demo     (needs SEED_DEMO=1; demo organizations)
//
// --catalog: iam.permission from PERMISSIONS + the system role templates (organization_id NULL) and their
//            role_permission rows (authoritative: extra rows of a system role are removed).
// --demo:    two organizations with schools, years, terms, levels/grades, subjects, classes, offerings, persons,
//            accounts and role assignments. Deterministic ids and phones â†’ re-running updates in place and RESETS
//            the demo passwords (SEED_DEMO_PASSWORD or a random one printed once).
// Refuses to run against production unless SEED_ALLOW=1. Tenant rows need `set_config('app.current_org_id')`
// inside the transaction because app_owner is subject to FORCE ROW LEVEL SECURITY like everyone else.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { IMPLICIT_PERMISSIONS, PERMISSIONS, type Permission, type ScopeType } from "../src/modules/iam/permissions";
import { generateInitialPassword, hashPassword } from "../src/modules/iam/password";

type Db = NodePgDatabase<typeof schema>;


const {
  organization,
  school,
  branch,
  academicYear,
  term,
  educationLevel,
  gradeLevel,
  subject,
  classGroup,
  classOffering,
  userAccount,
  authIdentity,
  person,
  organizationMembership,
  studentProfile,
  staffProfile,
  role,
  permission,
  rolePermission,
  roleAssignment,
} = schema;

// ---------------------------------------------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------------------------------------------

const ALL_ROLE_PERMS = PERMISSIONS.map((p) => p.code).filter((c) => !IMPLICIT_PERMISSIONS.includes(c));
const WORK_ITEM_ALL: Permission[] = [
  "workspace.work_item.read",
  "workspace.work_item.create",
  "workspace.work_item.update",
  "workspace.work_item.comment",
  "workspace.work_item.assign_class",
];

interface SystemRole {
  code: string;
  name: string;
  description: string;
  allowedScopeTypes: ScopeType[];
  permissions: Permission[];
}

/** System role templates (doc 03 آ§7). Custom roles are out of phase 1. */
export const SYSTEM_ROLES: SystemRole[] = [
  { code: "org_admin", name: "ظ…ط¯غŒط± ط³ط§ط²ظ…ط§ظ†", description: "ظ‡ظ…ظ‡ظ´ ط¯ط³طھط±ط³غŒâ€Œظ‡ط§ ط¯ط± ط³ط·ط­ ط³ط§ط²ظ…ط§ظ†", allowedScopeTypes: ["organization"], permissions: ALL_ROLE_PERMS },
  { code: "school_principal", name: "ظ…ط¯غŒط± ظ…ط¯ط±ط³ظ‡", description: "ظ‡ظ…ظ‡ظ´ ط¯ط³طھط±ط³غŒâ€Œظ‡ط§ ط¯ط± ط³ط·ط­ غŒع© ظ…ط¯ط±ط³ظ‡", allowedScopeTypes: ["school"], permissions: ALL_ROLE_PERMS },
  {
    code: "vice_principal",
    name: "ظ…ط¹ط§ظˆظ†",
    description: "ع©ط§ط±طھط§ط¨ظ„ ظˆ ط§ظپط±ط§ط¯ ط¯ط± ط³ط·ط­ ظ…ط¯ط±ط³ظ‡ غŒط§ ط´ط¹ط¨ظ‡",
    allowedScopeTypes: ["school", "branch"],
    permissions: ["tenancy.structure.read", "iam.person.read", ...WORK_ITEM_ALL, "notif.notification.read"],
  },
  {
    code: "teacher",
    name: "ظ…ط¹ظ„ظ…",
    description: "ع©ط§ط±طھط§ط¨ظ„ ط¯ط±ط³â€Œظ‡ط§غŒ ط®ظˆط¯",
    allowedScopeTypes: ["class_offering", "class_group"],
    permissions: [...WORK_ITEM_ALL, "notif.notification.read", "iam.person.read"],
  },
  {
    code: "student",
    name: "ط¯ط§ظ†ط´â€Œط¢ظ…ظˆط²",
    description: "ع©ط§ط±طھط§ط¨ظ„ ط®ظˆط¯",
    allowedScopeTypes: ["student"],
    permissions: ["workspace.work_item.read", "workspace.work_item.update", "workspace.work_item.comment", "notif.notification.read"],
  },
  {
    code: "guardian_full",
    name: "ظˆظ„غŒ",
    description: "ظ…ط´ط§ظ‡ط¯ظ‡ظ´ ع©ط§ط±طھط§ط¨ظ„ ظپط±ط²ظ†ط¯",
    allowedScopeTypes: ["student", "family"],
    permissions: ["workspace.work_item.read", "workspace.work_item.comment", "notif.notification.read"],
  },
];

export async function seedCatalog(db: Db): Promise<Record<string, string>> {
  return db.transaction(async (tx) => {
    await tx
      .insert(permission)
      .values(PERMISSIONS.map((p) => ({ code: p.code, module: p.module, name: p.name, isSensitive: p.isSensitive })))
      .onConflictDoUpdate({
        target: permission.code,
        set: { module: sql`excluded.module`, name: sql`excluded.name`, isSensitive: sql`excluded.is_sensitive` },
      });

    const roleIds: Record<string, string> = {};
    for (const r of SYSTEM_ROLES) {
      const [row] = await tx
        .insert(role)
        .values({ organizationId: null, code: r.code, name: r.name, description: r.description, isSystem: true, allowedScopeTypes: r.allowedScopeTypes })
        .onConflictDoUpdate({
          target: [role.organizationId, role.code],
          set: { name: r.name, description: r.description, isSystem: true, allowedScopeTypes: r.allowedScopeTypes },
        })
        .returning({ id: role.id });
      roleIds[r.code] = row.id;
      if (r.permissions.length > 0) {
        await tx
          .insert(rolePermission)
          .values(r.permissions.map((code) => ({ roleId: row.id, permissionCode: code })))
          .onConflictDoNothing();
        await tx.delete(rolePermission).where(and(eq(rolePermission.roleId, row.id), notInArray(rolePermission.permissionCode, r.permissions)));
      } else {
        await tx.delete(rolePermission).where(eq(rolePermission.roleId, row.id));
      }
    }
    return roleIds;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// demo
// ---------------------------------------------------------------------------------------------------------------

/** Deterministic UUID (v7-shaped, not time-ordered) from a stable key: re-runs hit the same rows. */
function demoId(key: string): string {
  const h = createHash("sha256").update(`edu-demo:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** +98912 3xx xxxx, unique per index. */
const demoPhone = (i: number) => `+98912${String(3000000 + i)}`;

interface DemoPerson {
  key: string;
  firstName: string;
  lastName: string;
  gender: "female" | "male";
  kind: "staff" | "student";
  /** role code â†’ scope; resolved after the structure exists */
  roles: Array<{ role: string; scope: "organization" } | { role: string; scope: "school"; school: string } | { role: string; scope: "class_offering"; offering: string } | { role: string; scope: "student" }>;
  studentNumber?: string;
  label: string;
}

const GIRLS = [
  ["ظ†ط±ع¯ط³", "ط­ط³غŒظ†غŒ"],
  ["ظپط§ط·ظ…ظ‡", "ع©ط§ط¸ظ…غŒ"],
  ["ظ…ظ‡ط³ط§", "ط±ط­غŒظ…غŒ"],
  ["ظ†ع¯ط§ط±", "طµط§ط¯ظ‚غŒ"],
  ["ط§ظ„ظ‡ط§ظ…", "ط¬ط¹ظپط±غŒ"],
  ["ظ¾ط±غŒط³ط§", "ظ†ظˆط±غŒ"],
  ["ط±غŒط­ط§ظ†ظ‡", "ظ‚ط§ط³ظ…غŒ"],
  ["غŒط§ط³ظ…ظ†", "ط´ط±غŒظپغŒ"],
  ["ظ…غŒظ†ط§", "ط¹ط¨ط§ط³غŒ"],
  ["ظ‡ط³طھغŒ", "ط·ط§ظ‡ط±غŒ"],
  ["ط³ط­ط±", "ط²ط§ط±ط¹غŒ"],
  ["ظ†غŒظ„ظˆظپط±", "ط¨ط§ظ‚ط±غŒ"],
] as const;

const NOOR_STUDENTS = [
  ["ط§ظ…غŒط±", "ط±ط¶ظˆط§ظ†غŒ", "male"],
  ["ط­ط³غŒظ†", "ظپظ„ط§ط­", "male"],
  ["ظ…ظ‡ط¯غŒ", "ط³ظ„ط·ط§ظ†غŒ", "male"],
] as const;

interface DemoOrgSpec {
  key: string;
  name: string;
  slug: string;
  schools: Array<{ code: string; name: string; gender: "girls" | "boys" | "mixed"; isDefault: boolean; classes: Array<{ name: string; grade: string }> }>;
  grades: Array<{ code: string; name: string; seq: number }>;
  subjects: Array<{ code: string; name: string }>;
  /** subjects offered in every class (term 1) */
  offered: string[];
  persons: DemoPerson[];
}

const DANESH: DemoOrgSpec = {
  key: "danesh",
  name: "ظ…ط¬طھظ…ط¹ ط¯ط§ظ†ط´",
  slug: "danesh-demo",
  schools: [
    { code: "G", name: "ط¯ط¨غŒط±ط³طھط§ظ† ط¯ط®طھط±ط§ظ†ظ‡ظ´ ط¯ط§ظ†ط´", gender: "girls", isDefault: true, classes: [{ name: "غ±غ°/غ±", grade: "G10" }, { name: "غ±غ°/غ²", grade: "G10" }] },
    { code: "B", name: "ط¯ط¨غŒط±ط³طھط§ظ† ظ¾ط³ط±ط§ظ†ظ‡ظ´ ط¯ط§ظ†ط´", gender: "boys", isDefault: false, classes: [{ name: "غ±غ±/غ³", grade: "G11" }] },
  ],
  grades: [
    { code: "G10", name: "ط¯ظ‡ظ…", seq: 1 },
    { code: "G11", name: "غŒط§ط²ط¯ظ‡ظ…", seq: 2 },
    { code: "G12", name: "ط¯ظˆط§ط²ط¯ظ‡ظ…", seq: 3 },
  ],
  subjects: [
    { code: "MATH", name: "ط±غŒط§ط¶غŒ" },
    { code: "PHYS", name: "ظپغŒط²غŒع©" },
    { code: "CHEM", name: "ط´غŒظ…غŒ" },
    { code: "ENG", name: "ط²ط¨ط§ظ†" },
  ],
  offered: ["MATH", "PHYS"],
  persons: [
    { key: "admin", firstName: "ظ…ط­ظ…ط¯", lastName: "ط§ظ…غŒظ†غŒ", gender: "male", kind: "staff", label: "ظ…ط¯غŒط± ط³ط§ط²ظ…ط§ظ†", roles: [{ role: "org_admin", scope: "organization" }] },
    { key: "rezaei", firstName: "ظ…ط±غŒظ…", lastName: "ط±ط¶ط§غŒغŒ", gender: "female", kind: "staff", label: "ظ…ط¯غŒط± ط¯ط¨غŒط±ط³طھط§ظ† ط¯ط®طھط±ط§ظ†ظ‡", roles: [{ role: "school_principal", scope: "school", school: "G" }] },
    {
      key: "karimi",
      firstName: "ط¹ظ„غŒ",
      lastName: "ع©ط±غŒظ…غŒ",
      gender: "male",
      kind: "staff",
      label: "ظ…ط¹ظ„ظ… ط±غŒط§ط¶غŒ غ±غ°/غ± ظˆ غ±غ°/غ²",
      roles: [
        { role: "teacher", scope: "class_offering", offering: "G:غ±غ°/غ±:MATH" },
        { role: "teacher", scope: "class_offering", offering: "G:غ±غ°/غ²:MATH" },
      ],
    },
    { key: "mousavi", firstName: "ط²ظ‡ط±ط§", lastName: "ظ…ظˆط³ظˆغŒ", gender: "female", kind: "staff", label: "ظ…ط¹ط§ظˆظ† ط¯ط¨غŒط±ط³طھط§ظ† ظ¾ط³ط±ط§ظ†ظ‡", roles: [{ role: "vice_principal", scope: "school", school: "B" }] },
    { key: "sara", firstName: "ط³ط§ط±ط§", lastName: "ظ…ط­ظ…ط¯غŒ", gender: "female", kind: "student", label: "ط¯ط§ظ†ط´â€Œط¢ظ…ظˆط²", studentNumber: "14050001", roles: [{ role: "student", scope: "student" }] },
    ...GIRLS.map<DemoPerson>(([firstName, lastName], i) => ({
      key: `student-${i + 2}`,
      firstName,
      lastName,
      gender: "female",
      kind: "student",
      label: "ط¯ط§ظ†ط´â€Œط¢ظ…ظˆط²",
      studentNumber: `140500${String(i + 2).padStart(2, "0")}`,
      roles: [{ role: "student", scope: "student" }],
    })),
  ],
};

const NOOR: DemoOrgSpec = {
  key: "noor",
  name: "ظ…ط¯ط±ط³ظ‡ظ´ ظ†ظˆط±",
  slug: "noor-demo",
  schools: [{ code: "N", name: "ظ…ط¯ط±ط³ظ‡ظ´ ظ†ظˆط±", gender: "mixed", isDefault: true, classes: [{ name: "غ±غ°/غ±", grade: "G10" }] }],
  grades: [{ code: "G10", name: "ط¯ظ‡ظ…", seq: 1 }],
  subjects: [{ code: "MATH", name: "ط±غŒط§ط¶غŒ" }],
  offered: ["MATH"],
  persons: [
    { key: "admin", firstName: "ط³ط¹غŒط¯", lastName: "ظ†ظˆط±غŒ", gender: "male", kind: "staff", label: "ظ…ط¯غŒط± ط³ط§ط²ظ…ط§ظ†", roles: [{ role: "org_admin", scope: "organization" }] },
    { key: "teacher", firstName: "ظ„غŒظ„ط§", lastName: "ع©ط±غŒظ…غŒ", gender: "female", kind: "staff", label: "ظ…ط¹ظ„ظ… ط±غŒط§ط¶غŒ غ±غ°/غ±", roles: [{ role: "teacher", scope: "class_offering", offering: "N:غ±غ°/غ±:MATH" }] },
    ...NOOR_STUDENTS.map<DemoPerson>(([firstName, lastName, gender], i) => ({
      key: `student-${i + 1}`,
      firstName,
      lastName,
      gender,
      kind: "student",
      label: "ط¯ط§ظ†ط´â€Œط¢ظ…ظˆط²",
      studentNumber: `140510${String(i + 1).padStart(2, "0")}`,
      roles: [{ role: "student", scope: "student" }],
    })),
  ],
};

interface DemoLogin {
  org: string;
  name: string;
  label: string;
  phone: string;
}

interface DemoOptions {
  password: string;
  forceChange: boolean;
  roleIds: Record<string, string>;
  phoneOffset: number;
}

async function seedDemoOrg(db: Db, spec: DemoOrgSpec, opts: DemoOptions): Promise<DemoLogin[]> {
  const orgId = demoId(`org:${spec.key}`);
  // Global row: no RLS.
  await db
    .insert(organization)
    .values({ id: orgId, name: spec.name, slug: spec.slug, status: "active" })
    .onConflictDoUpdate({ target: organization.slug, set: { name: spec.name, status: "active" } });

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
    const k = (s: string) => `${spec.key}:${s}`;

    // ---- structure ----
    const [level] = await tx
      .insert(educationLevel)
      .values({ id: demoId(k("level:SEC2")), organizationId: orgId, name: "ظ…طھظˆط³ط·ظ‡ظ´ ط¯ظˆظ…", code: "SEC2", sequence: 1 })
      .onConflictDoUpdate({ target: [educationLevel.organizationId, educationLevel.code], set: { name: "ظ…طھظˆط³ط·ظ‡ظ´ ط¯ظˆظ…", sequence: 1 } })
      .returning({ id: educationLevel.id });

    const gradeIds: Record<string, string> = {};
    for (const g of spec.grades) {
      const [row] = await tx
        .insert(gradeLevel)
        .values({ id: demoId(k(`grade:${g.code}`)), organizationId: orgId, educationLevelId: level.id, name: g.name, code: g.code, sequence: g.seq })
        .onConflictDoUpdate({ target: [gradeLevel.organizationId, gradeLevel.code], set: { name: g.name, sequence: g.seq, educationLevelId: level.id } })
        .returning({ id: gradeLevel.id });
      gradeIds[g.code] = row.id;
    }

    const subjectIds: Record<string, string> = {};
    for (const s of spec.subjects) {
      const [row] = await tx
        .insert(subject)
        .values({ id: demoId(k(`subject:${s.code}`)), organizationId: orgId, name: s.name, code: s.code })
        .onConflictDoUpdate({ target: [subject.organizationId, subject.code], set: { name: s.name } })
        .returning({ id: subject.id });
      subjectIds[s.code] = row.id;
    }

    const schoolIds: Record<string, string> = {};
    const offeringIds: Record<string, string> = {};
    for (const s of spec.schools) {
      const [sch] = await tx
        .insert(school)
        .values({ id: demoId(k(`school:${s.code}`)), organizationId: orgId, name: s.name, code: s.code, genderPolicy: s.gender, isDefault: s.isDefault })
        .onConflictDoUpdate({ target: [school.organizationId, school.code], set: { name: s.name, genderPolicy: s.gender, isDefault: s.isDefault } })
        .returning({ id: school.id });
      schoolIds[s.code] = sch.id;

      const [br] = await tx
        .insert(branch)
        .values({ id: demoId(k(`branch:${s.code}`)), organizationId: orgId, schoolId: sch.id, name: "ظ…ط±ع©ط²غŒ", isDefault: true })
        .onConflictDoUpdate({ target: branch.id, set: { name: "ظ…ط±ع©ط²غŒ", isDefault: true, schoolId: sch.id } })
        .returning({ id: branch.id });

      const [year] = await tx
        .insert(academicYear)
        .values({
          id: demoId(k(`year:${s.code}:1405`)),
          organizationId: orgId,
          schoolId: sch.id,
          name: "غ±غ´غ°غµ-غ±غ´غ°غ¶",
          startsOn: "2026-09-23",
          endsOn: "2027-06-21",
          isCurrent: true,
        })
        .onConflictDoUpdate({ target: academicYear.id, set: { name: "غ±غ´غ°غµ-غ±غ´غ°غ¶", startsOn: "2026-09-23", endsOn: "2027-06-21", isCurrent: true } })
        .returning({ id: academicYear.id });

      const termIds: string[] = [];
      const terms = [
        { seq: 1, name: "ظ†ظˆط¨طھ ط§ظˆظ„", startsOn: "2026-09-23", endsOn: "2027-01-20" },
        { seq: 2, name: "ظ†ظˆط¨طھ ط¯ظˆظ…", startsOn: "2027-01-21", endsOn: "2027-06-21" },
      ];
      for (const t of terms) {
        const [row] = await tx
          .insert(term)
          .values({ id: demoId(k(`term:${s.code}:${t.seq}`)), organizationId: orgId, academicYearId: year.id, name: t.name, sequence: t.seq, startsOn: t.startsOn, endsOn: t.endsOn })
          .onConflictDoUpdate({ target: [term.academicYearId, term.sequence], set: { name: t.name, startsOn: t.startsOn, endsOn: t.endsOn } })
          .returning({ id: term.id });
        termIds.push(row.id);
      }

      for (const c of s.classes) {
        const [cg] = await tx
          .insert(classGroup)
          .values({ id: demoId(k(`class:${s.code}:${c.name}`)), organizationId: orgId, branchId: br.id, academicYearId: year.id, gradeLevelId: gradeIds[c.grade], name: c.name, capacity: 30 })
          .onConflictDoUpdate({ target: [classGroup.academicYearId, classGroup.branchId, classGroup.name], set: { gradeLevelId: gradeIds[c.grade], status: "active" } })
          .returning({ id: classGroup.id });
        for (const code of spec.offered) {
          const [off] = await tx
            .insert(classOffering)
            .values({ id: demoId(k(`offering:${s.code}:${c.name}:${code}`)), organizationId: orgId, classGroupId: cg.id, subjectId: subjectIds[code], termId: termIds[0], weeklyHours: "4.0", status: "active" })
            .onConflictDoUpdate({ target: [classOffering.classGroupId, classOffering.subjectId, classOffering.termId], set: { status: "active" } })
            .returning({ id: classOffering.id });
          offeringIds[`${s.code}:${c.name}:${code}`] = off.id;
        }
      }
    }

    // ---- people ----
    const logins: DemoLogin[] = [];
    for (const [i, p] of spec.persons.entries()) {
      const personId = demoId(k(`person:${p.key}`));
      const phone = demoPhone(opts.phoneOffset + i);
      await tx
        .insert(person)
        .values({ id: personId, organizationId: orgId, firstName: p.firstName, lastName: p.lastName, gender: p.gender, externalRef: `demo:${p.key}`, status: "active" })
        .onConflictDoUpdate({ target: person.id, set: { firstName: p.firstName, lastName: p.lastName, gender: p.gender, status: "active" } });

      let studentProfileId: string | undefined;
      if (p.kind === "student") {
        const [sp] = await tx
          .insert(studentProfile)
          .values({ id: demoId(k(`student:${p.key}`)), organizationId: orgId, personId, studentNumber: p.studentNumber!, status: "active", admittedOn: "2026-09-23" })
          .onConflictDoUpdate({ target: [studentProfile.organizationId, studentProfile.studentNumber], set: { status: "active" } })
          .returning({ id: studentProfile.id });
        studentProfileId = sp.id;
      } else {
        await tx
          .insert(staffProfile)
          .values({ id: demoId(k(`staff:${p.key}`)), organizationId: orgId, personId, employmentType: "full_time", hiredOn: "2026-09-01" })
          .onConflictDoUpdate({ target: staffProfile.personId, set: { employmentType: "full_time" } });
      }

      // Global rows: account + password identity (re-seeding resets the demo password).
      const [acct] = await tx
        .insert(userAccount)
        .values({ id: demoId(k(`account:${p.key}`)), loginIdentifier: phone, phoneE164: phone, status: "active", mustChangePassword: opts.forceChange })
        .onConflictDoUpdate({
          target: userAccount.loginIdentifier,
          set: { phoneE164: phone, status: "active", mustChangePassword: opts.forceChange, failedLoginCount: 0, lockedUntil: null },
        })
        .returning({ id: userAccount.id });
      const secretHash = await hashPassword(opts.password);
      await tx
        .insert(authIdentity)
        .values({ id: demoId(k(`identity:${p.key}`)), userAccountId: acct.id, provider: "password", secretHash })
        .onConflictDoUpdate({ target: [authIdentity.userAccountId, authIdentity.provider], set: { secretHash, initialPasswordEnc: null } });

      await tx
        .insert(organizationMembership)
        .values({ id: demoId(k(`membership:${p.key}`)), organizationId: orgId, userAccountId: acct.id, personId, status: "active", isDefaultOrg: true })
        .onConflictDoUpdate({ target: [organizationMembership.organizationId, organizationMembership.userAccountId], set: { status: "active", isDefaultOrg: true } });

      for (const r of p.roles) {
        const roleId = opts.roleIds[r.role];
        if (!roleId) throw new Error(`system role ${r.role} missing â€” run --catalog first`);
        let scope: { scopeType: ScopeType; schoolId?: string; classOfferingId?: string; studentProfileId?: string };
        let scopeId: string | undefined;
        if (r.scope === "organization") {
          scope = { scopeType: "organization" };
          scopeId = orgId;
        } else if (r.scope === "school") {
          scopeId = schoolIds[r.school];
          scope = { scopeType: "school", schoolId: scopeId };
        } else if (r.scope === "class_offering") {
          scopeId = offeringIds[r.offering];
          scope = { scopeType: "class_offering", classOfferingId: scopeId };
        } else {
          scopeId = studentProfileId;
          scope = { scopeType: "student", studentProfileId: scopeId };
        }
        if (!scopeId) throw new Error(`unresolved scope for ${p.key}: ${JSON.stringify(r)}`);
        const existing = await tx
          .select({ id: roleAssignment.id })
          .from(roleAssignment)
          .where(and(eq(roleAssignment.personId, personId), eq(roleAssignment.roleId, roleId), eq(roleAssignment.scopeType, scope.scopeType), eq(roleAssignment.scopeId, scopeId), isNull(roleAssignment.revokedAt)))
          .limit(1);
        if (existing.length === 0) {
          await tx.insert(roleAssignment).values({
            id: demoId(k(`assignment:${p.key}:${r.role}:${scopeId}`)),
            organizationId: orgId,
            personId,
            roleId,
            ...scope,
            // Karimi's teacher rows are what the teacher_assignment table (DB step 2) will derive; mark them so.
            sourceType: r.scope === "class_offering" ? "teacher_assignment" : "manual",
            grantedByPersonId: demoId(k("person:admin")),
          });
        }
      }

      logins.push({ org: spec.name, name: `${p.firstName} ${p.lastName}`, label: p.label, phone });
    }
    return logins;
  });
}

export async function seedDemo(db: Db, roleIds: Record<string, string>): Promise<{ logins: DemoLogin[]; password: string; generated: boolean }> {
  const envPassword = process.env.SEED_DEMO_PASSWORD;
  const password = envPassword && envPassword.length >= 8 ? envPassword : generateInitialPassword();
  const forceChange = process.env.SEED_DEMO_NO_FORCE !== "1";
  const a = await seedDemoOrg(db, DANESH, { password, forceChange, roleIds, phoneOffset: 1 });
  const b = await seedDemoOrg(db, NOOR, { password, forceChange, roleIds, phoneOffset: 101 });
  return { logins: [...a, ...b], password, generated: !envPassword };
}

// ---------------------------------------------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------------------------------------------

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* the missing-variable error below is clearer */
  }
}

const faDigits = (s: string) => s.replace(/\d/g, (d) => "غ°غ±غ²غ³غ´غµغ¶غ·غ¸غ¹"[Number(d)]);

function printLogins(logins: DemoLogin[], password: string, generated: boolean, forceChange: boolean): void {
  const width = Math.max(...logins.map((l) => l.name.length), 4) + 2;
  const labelWidth = Math.max(...logins.map((l) => l.label.length), 4) + 2;
  console.log("\nط­ط³ط§ط¨â€Œظ‡ط§غŒ ط¯ظ…ظˆ (ظˆط±ظˆط¯ ط¨ط§ ط´ظ…ط§ط±ظ‡ظ´ ظ…ظˆط¨ط§غŒظ„):");
  console.log(`${"ظ†ط§ظ…".padEnd(width)}${"ظ†ظ‚ط´".padEnd(labelWidth)}${"ظ…ظˆط¨ط§غŒظ„".padEnd(16)}ط³ط§ط²ظ…ط§ظ†`);
  console.log("-".repeat(width + labelWidth + 16 + 14));
  for (const l of logins) console.log(`${l.name.padEnd(width)}${l.label.padEnd(labelWidth)}${faDigits(l.phone).padEnd(16)}${l.org}`);
  console.log(`\nط±ظ…ط² ظ‡ظ…ظ‡ظ´ ط­ط³ط§ط¨â€Œظ‡ط§غŒ ط¯ظ…ظˆ${generated ? " (طھطµط§ط¯ظپغŒط› ظپظ‚ط· ط§غŒظ†â€Œط¬ط§ ع†ط§ظ¾ ظ…غŒâ€Œط´ظˆط¯)" : " (ط§ط² SEED_DEMO_PASSWORD)"}: ${password}`);
  console.log(forceChange ? "ط¯ط± ط§ظˆظ„غŒظ† ظˆط±ظˆط¯ طھط؛غŒغŒط± ط±ظ…ط² ط§ط¬ط¨ط§ط±غŒ ط§ط³طھ." : "SEED_DEMO_NO_FORCE=1 â€” طھط؛غŒغŒط± ط±ظ…ط² ط§ط¬ط¨ط§ط±غŒ ظ†غŒط³طھ.");
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = new Set(process.argv.slice(2));
  const doCatalog = args.has("--catalog");
  const doDemo = args.has("--demo");
  if (!doCatalog && !doDemo) {
    console.error("usage: tsx scripts/seed.ts --catalog [--demo]   (--demo needs SEED_DEMO=1)");
    process.exit(2);
  }
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW !== "1") {
    console.error("[seed] refusing to run with NODE_ENV=production without SEED_ALLOW=1");
    process.exit(3);
  }
  if (doDemo && process.env.SEED_DEMO !== "1") {
    console.error("[seed] --demo requires SEED_DEMO=1 in the environment (.env)");
    process.exit(3);
  }
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is not set (see .env.example)");

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const db = drizzle({ client: pool, schema });
    const roleIds = doCatalog
      ? await seedCatalog(db)
      : Object.fromEntries((await db.select({ code: role.code, id: role.id }).from(role).where(and(isNull(role.organizationId), inArray(role.code, SYSTEM_ROLES.map((r) => r.code))))).map((r) => [r.code, r.id]));
    if (doCatalog) console.log(`[seed] catalog: ${PERMISSIONS.length} permissions, ${SYSTEM_ROLES.length} system roles`);
    if (doDemo) {
      const { logins, password, generated } = await seedDemo(db, roleIds);
      console.log(`[seed] demo: ${logins.length} accounts in 2 organizations`);
      printLogins(logins, password, generated, process.env.SEED_DEMO_NO_FORCE !== "1");
    }
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error("[seed] FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
