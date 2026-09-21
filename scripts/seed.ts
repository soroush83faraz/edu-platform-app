// Seed. Runs as app_owner (MIGRATION_DATABASE_URL) with its OWN pool — never through withTenant/withoutTenant.
//
//   pnpm seed            = tsx scripts/seed.ts --catalog            (idempotent; run after every migrate)
//   pnpm seed:demo       = tsx scripts/seed.ts --catalog --demo     (needs SEED_DEMO=1; demo organizations)
//
// --catalog: iam.permission from PERMISSIONS + the system role templates (organization_id NULL) and their
//            role_permission rows (authoritative: extra rows of a system role are removed); the system
//            workspace.work_item_type rows (organization_id NULL) with their work_item_status catalog; and
//            notif.notification_type. The data and the writer live in ./catalog (pg-only), shared with the
//            compiled scripts/seed-catalog.js that the deploy runs after `migrate` (deploy/README.md).
// --demo:    two organizations with schools, years, terms, levels/grades, subjects, classes, offerings, persons,
//            accounts and role assignments; the students are enrolled in their class (school_enrollment +
//            class_enrollment) and the teachers get real academic.teacher_assignment rows through the academic
//            service (which derives the `teacher` role_assignment). Deterministic ids and phones → re-running
//            updates in place and RESETS the demo passwords (SEED_DEMO_PASSWORD or a random one printed once).
// Refuses to run against production unless SEED_ALLOW=1. Tenant rows need `set_config('app.current_org_id')`
// inside the transaction because app_owner is subject to FORCE ROW LEVEL SECURITY like everyone else.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle, type NodePgClient, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { assignTeacher, enrollStudent, type ServiceCtx } from "../src/modules/academic/service";
import { IMPLICIT_PERMISSIONS, PERMISSIONS } from "../src/modules/iam/permissions";
import { generateInitialPassword } from "../src/modules/iam/password";
import { assignRole, createStaff, createStudent, findAccountOfPerson, setAccountPassword, updatePerson, type IamCtx } from "../src/modules/iam/service";
import {
  findAcademicYearByName,
  findClassGroupByName,
  findDefaultBranch,
  findEducationLevelByCode,
  findGradeLevelByCode,
  findOffering,
  findSchoolByCode,
  findSubjectByCode,
} from "../src/modules/tenancy/repo";
import {
  createAcademicYear,
  createBranch,
  createClassGroup,
  createClassOffering,
  createEducationLevel,
  createGradeLevel,
  createSchool,
  createSubject,
  structureCounts,
  updateAcademicYear,
  updateClassGroup,
  updateClassOffering,
  updateEducationLevel,
  updateGradeLevel,
  updateSchool,
  updateSubject,
  upsertTerm,
} from "../src/modules/tenancy/service";
import { SYSTEM_ROLES, catalogCountsWith, formatCatalogSummary, seedCatalogWith, type CatalogCounts, type Queryable } from "./catalog";

export { NOTIFICATION_TYPES, SYSTEM_ROLES, SYSTEM_WORK_ITEM_TYPES, type CatalogCounts } from "./catalog";
const SYSTEM_ROLE_CODES = SYSTEM_ROLES.map((r) => r.code);

/** What `drizzle({ client })` returns: the database plus its driver (`$client`), which the catalog seed writes through. */
type Db = NodePgDatabase<typeof schema> & { $client: NodePgClient };


const { organization, person, studentProfile, staffProfile, role, roleAssignment, classEnrollment, teacherAssignment } = schema;

// ---------------------------------------------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------------------------------------------

const ALL_ROLE_PERMS = PERMISSIONS.map((p) => p.code).filter((c) => !IMPLICIT_PERMISSIONS.includes(c));

/** One connection of the drizzle database's driver: a checked-out client of its Pool, or the Client it wraps. */
async function withDriverConnection<T>(db: Db, fn: (q: Queryable) => Promise<T>): Promise<T> {
  const client = db.$client;
  if (client instanceof Pool) {
    const c = await client.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  }
  return fn(client);
}

/**
 * The catalog seed through a drizzle `Db` (the CLI below, seed-pilot, the int tests): `seedCatalogWith` on ONE
 * driver connection — one transaction — returns the system role ids by code. The same function, over the same
 * SQL, is what the compiled scripts/seed-catalog.js runs on the server.
 */
export async function seedCatalog(db: Db): Promise<Record<string, string>> {
  return withDriverConnection(db, (q) => seedCatalogWith(q));
}

/** Row counts of the catalog tables (see ./catalog). */
export async function catalogCounts(db: Db): Promise<CatalogCounts> {
  return withDriverConnection(db, (q) => catalogCountsWith(q));
}

// ---------------------------------------------------------------------------------------------------------------
// demo
// ---------------------------------------------------------------------------------------------------------------

/** Deterministic UUID (v7-shaped, not time-ordered) from a stable key: re-runs hit the same rows. */
export function demoId(key: string): string {
  const h = createHash("sha256").update(`edu-demo:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** +98912 3xx xxxx, unique per index. */
export const demoPhone = (i: number) => `+98912${String(3000000 + i)}`;

/** The demo staff member's primary school: first school-scoped role, else the school of the first taught offering. */
export function demoStaffSchoolId(p: DemoPerson, schoolIds: Record<string, string>): string | null {
  for (const r of p.roles) {
    if (r.scope === "school") return schoolIds[r.school] ?? null;
  }
  for (const r of p.roles) {
    if (r.scope === "class_offering") return schoolIds[r.offering.split(":")[0]] ?? null;
  }
  return null;
}

export interface DemoPerson {
  key: string;
  firstName: string;
  lastName: string;
  gender: "female" | "male";
  kind: "staff" | "student";
  /** role code → scope; resolved after the structure exists */
  roles: Array<{ role: string; scope: "organization" } | { role: string; scope: "school"; school: string } | { role: string; scope: "class_offering"; offering: string } | { role: string; scope: "student" }>;
  studentNumber?: string;
  label: string;
}

const GIRLS = [
  ["نرگس", "حسینی"],
  ["فاطمه", "کاظمی"],
  ["مهسا", "رحیمی"],
  ["نگار", "صادقی"],
  ["الهام", "جعفری"],
  ["پریسا", "نوری"],
  ["ریحانه", "قاسمی"],
  ["یاسمن", "شریفی"],
  ["مینا", "عباسی"],
  ["هستی", "طاهری"],
  ["سحر", "زارعی"],
  ["نیلوفر", "باقری"],
] as const;

const NOOR_STUDENTS = [
  ["امیر", "رضوانی", "male"],
  ["حسین", "فلاح", "male"],
  ["مهدی", "سلطانی", "male"],
] as const;

export interface DemoOrgSpec {
  key: string;
  name: string;
  slug: string;
  schools: Array<{ code: string; name: string; gender: "girls" | "boys" | "mixed"; isDefault: boolean; classes: Array<{ name: string; grade: string }> }>;
  grades: Array<{ code: string; name: string; seq: number }>;
  subjects: Array<{ code: string; name: string }>;
  /** subjects offered in every class (term 1) */
  offered: string[];
  /** `<school code>:<class name>` every demo student is enrolled in */
  studentClass: string;
  persons: DemoPerson[];
}

export const DANESH: DemoOrgSpec = {
  key: "danesh",
  name: "مجتمع دانش",
  slug: "danesh-demo",
  schools: [
    { code: "G", name: "دبیرستان دخترانهٴ دانش", gender: "girls", isDefault: true, classes: [{ name: "۱۰/۱", grade: "G10" }, { name: "۱۰/۲", grade: "G10" }] },
    { code: "B", name: "دبیرستان پسرانهٴ دانش", gender: "boys", isDefault: false, classes: [{ name: "۱۱/۳", grade: "G11" }] },
  ],
  grades: [
    { code: "G10", name: "دهم", seq: 1 },
    { code: "G11", name: "یازدهم", seq: 2 },
    { code: "G12", name: "دوازدهم", seq: 3 },
  ],
  subjects: [
    { code: "MATH", name: "ریاضی" },
    { code: "PHYS", name: "فیزیک" },
    { code: "CHEM", name: "شیمی" },
    { code: "ENG", name: "زبان" },
  ],
  offered: ["MATH", "PHYS"],
  studentClass: "G:۱۰/۲",
  persons: [
    { key: "admin", firstName: "محمد", lastName: "امینی", gender: "male", kind: "staff", label: "مدیر سازمان", roles: [{ role: "org_admin", scope: "organization" }] },
    { key: "rezaei", firstName: "مریم", lastName: "رضایی", gender: "female", kind: "staff", label: "مدیر دبیرستان دخترانه", roles: [{ role: "school_principal", scope: "school", school: "G" }] },
    {
      key: "karimi",
      firstName: "علی",
      lastName: "کریمی",
      gender: "male",
      kind: "staff",
      label: "معلم ریاضی ۱۰/۱ و ۱۰/۲",
      roles: [
        { role: "teacher", scope: "class_offering", offering: "G:۱۰/۱:MATH" },
        { role: "teacher", scope: "class_offering", offering: "G:۱۰/۲:MATH" },
      ],
    },
    { key: "mousavi", firstName: "زهرا", lastName: "موسوی", gender: "female", kind: "staff", label: "معاون دبیرستان پسرانه", roles: [{ role: "vice_principal", scope: "school", school: "B" }] },
    { key: "sara", firstName: "سارا", lastName: "محمدی", gender: "female", kind: "student", label: "دانش‌آموز", studentNumber: "14050001", roles: [{ role: "student", scope: "student" }] },
    ...GIRLS.map<DemoPerson>(([firstName, lastName], i) => ({
      key: `student-${i + 2}`,
      firstName,
      lastName,
      gender: "female",
      kind: "student",
      label: "دانش‌آموز",
      studentNumber: `140500${String(i + 2).padStart(2, "0")}`,
      roles: [{ role: "student", scope: "student" }],
    })),
  ],
};

const NOOR: DemoOrgSpec = {
  key: "noor",
  name: "مدرسهٴ نور",
  slug: "noor-demo",
  schools: [{ code: "N", name: "مدرسهٴ نور", gender: "mixed", isDefault: true, classes: [{ name: "۱۰/۱", grade: "G10" }] }],
  grades: [{ code: "G10", name: "دهم", seq: 1 }],
  subjects: [{ code: "MATH", name: "ریاضی" }],
  offered: ["MATH"],
  studentClass: "N:۱۰/۱",
  persons: [
    { key: "admin", firstName: "سعید", lastName: "نوری", gender: "male", kind: "staff", label: "مدیر سازمان", roles: [{ role: "org_admin", scope: "organization" }] },
    { key: "teacher", firstName: "لیلا", lastName: "کریمی", gender: "female", kind: "staff", label: "معلم ریاضی ۱۰/۱", roles: [{ role: "teacher", scope: "class_offering", offering: "N:۱۰/۱:MATH" }] },
    ...NOOR_STUDENTS.map<DemoPerson>(([firstName, lastName, gender], i) => ({
      key: `student-${i + 1}`,
      firstName,
      lastName,
      gender,
      kind: "student",
      label: "دانش‌آموز",
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

export interface DemoCounts extends Record<string, number> {
  schoolEnrollments: number;
  classEnrollments: number;
  teacherAssignments: number;
  derivedTeacherRoles: number;
}

async function seedDemoOrg(db: Db, spec: DemoOrgSpec, opts: DemoOptions): Promise<{ logins: DemoLogin[]; counts: DemoCounts }> {
  const orgId = demoId(`org:${spec.key}`);
  // Global row: no RLS.
  await db
    .insert(organization)
    .values({ id: orgId, name: spec.name, slug: spec.slug, status: "active" })
    .onConflictDoUpdate({ target: organization.slug, set: { name: spec.name, status: "active" } });

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
    const k = (s: string) => `${spec.key}:${s}`;
    // The demo org admin is the actor of every seeded change (audit rows, granted_by). Their person row is created
    // below through createStaff with this deterministic id. The seed ACTS AS that organization admin: the services'
    // permission checks (`assignRole` → can(iam.role_assignment.write), the admin scope rule) see the same
    // organization-scoped org_admin assignment a real login of theirs would carry — there is no unchecked ctx.
    const ctx: IamCtx = {
      orgId,
      personId: demoId(k("person:admin")),
      userId: null,
      requestId: "seed",
      assignments: [{ roleCode: "org_admin", roleId: opts.roleIds.org_admin, scopeType: "organization", scopeId: orgId, permissions: ALL_ROLE_PERMS }],
    };

    // ---- structure (find by natural key → update in place, else create with the deterministic id) ----
    const levelRow = await findEducationLevelByCode(tx, "SEC2");
    let levelId: string;
    if (levelRow) {
      await updateEducationLevel(tx, ctx, levelRow.id, { name: "متوسطهٴ دوم", sequence: 1 });
      levelId = levelRow.id;
    } else {
      levelId = (await createEducationLevel(tx, ctx, { id: demoId(k("level:SEC2")), name: "متوسطهٴ دوم", code: "SEC2", sequence: 1 })).educationLevelId;
    }

    const gradeIds: Record<string, string> = {};
    for (const g of spec.grades) {
      const existing = await findGradeLevelByCode(tx, g.code);
      if (existing) {
        await updateGradeLevel(tx, ctx, existing.id, { name: g.name, sequence: g.seq, educationLevelId: levelId });
        gradeIds[g.code] = existing.id;
      } else {
        gradeIds[g.code] = (await createGradeLevel(tx, ctx, { id: demoId(k(`grade:${g.code}`)), educationLevelId: levelId, name: g.name, code: g.code, sequence: g.seq })).gradeLevelId;
      }
    }

    const subjectIds: Record<string, string> = {};
    for (const sj of spec.subjects) {
      const existing = await findSubjectByCode(tx, sj.code);
      if (existing) {
        await updateSubject(tx, ctx, existing.id, { name: sj.name });
        subjectIds[sj.code] = existing.id;
      } else {
        subjectIds[sj.code] = (await createSubject(tx, ctx, { id: demoId(k(`subject:${sj.code}`)), name: sj.name, code: sj.code })).subjectId;
      }
    }

    const schoolIds: Record<string, string> = {};
    const offeringIds: Record<string, string> = {};
    const classIds: Record<string, string> = {};
    for (const s of spec.schools) {
      let schoolId: string;
      let branchId: string;
      const existing = await findSchoolByCode(tx, s.code);
      if (existing) {
        await updateSchool(tx, ctx, existing.id, { name: s.name, genderPolicy: s.gender, isDefault: s.isDefault });
        schoolId = existing.id;
        const br = await findDefaultBranch(tx, schoolId);
        branchId = br ? br.id : (await createBranch(tx, ctx, { id: demoId(k(`branch:${s.code}`)), schoolId, name: "مرکزی", isDefault: true })).branchId;
      } else {
        const created = await createSchool(tx, ctx, {
          id: demoId(k(`school:${s.code}`)),
          branchId: demoId(k(`branch:${s.code}`)),
          name: s.name,
          code: s.code,
          genderPolicy: s.gender,
          isDefault: s.isDefault,
        });
        schoolId = created.schoolId;
        branchId = created.branchId;
      }
      schoolIds[s.code] = schoolId;

      const yearName = "۱۴۰۵-۱۴۰۶";
      const yearInput = { name: yearName, startsOn: "2026-09-23", endsOn: "2027-06-21", isCurrent: true };
      const terms = [
        { seq: 1, name: "نوبت اول", startsOn: "2026-09-23", endsOn: "2027-01-20" },
        { seq: 2, name: "نوبت دوم", startsOn: "2027-01-21", endsOn: "2027-06-21" },
      ];
      const existingYear = await findAcademicYearByName(tx, schoolId, yearName);
      let yearId: string;
      if (existingYear) {
        await updateAcademicYear(tx, ctx, existingYear.id, yearInput);
        yearId = existingYear.id;
      } else {
        yearId = (await createAcademicYear(tx, ctx, { id: demoId(k(`year:${s.code}:1405`)), schoolId, ...yearInput })).academicYearId;
      }
      const termIds: string[] = [];
      for (const t of terms) {
        const res = await upsertTerm(tx, ctx, { id: demoId(k(`term:${s.code}:${t.seq}`)), academicYearId: yearId, name: t.name, sequence: t.seq, startsOn: t.startsOn, endsOn: t.endsOn });
        termIds.push(res.termId);
      }

      for (const c of s.classes) {
        const existingClass = await findClassGroupByName(tx, yearId, branchId, c.name);
        let classGroupId: string;
        if (existingClass) {
          await updateClassGroup(tx, ctx, existingClass.id, { gradeLevelId: gradeIds[c.grade], status: "active" });
          classGroupId = existingClass.id;
        } else {
          const res = await createClassGroup(tx, ctx, { id: demoId(k(`class:${s.code}:${c.name}`)), branchId, academicYearId: yearId, gradeLevelId: gradeIds[c.grade], name: c.name, capacity: 30 });
          classGroupId = res.classGroupId;
        }
        classIds[`${s.code}:${c.name}`] = classGroupId;
        for (const code of spec.offered) {
          const existingOffering = await findOffering(tx, classGroupId, subjectIds[code], termIds[0]);
          let offeringId: string;
          if (existingOffering) {
            await updateClassOffering(tx, ctx, existingOffering.id, { status: "active" });
            offeringId = existingOffering.id;
          } else {
            const res = await createClassOffering(tx, ctx, {
              id: demoId(k(`offering:${s.code}:${c.name}:${code}`)),
              classGroupId,
              subjectId: subjectIds[code],
              termId: termIds[0],
              weeklyHours: 4,
              status: "active",
            });
            offeringId = res.classOfferingId;
          }
          offeringIds[`${s.code}:${c.name}:${code}`] = offeringId;
        }
      }
    }

    // ---- people (find by external_ref `demo:<key>` → update names + reset password, else create through the services) ----
    const logins: DemoLogin[] = [];
    const studentProfileIds: string[] = [];
    const teacherPlans: Array<{ staffProfileId: string; classOfferingId: string }> = [];
    for (const [i, p] of spec.persons.entries()) {
      const phone = demoPhone(opts.phoneOffset + i);
      const externalRef = `demo:${p.key}`;
      const [existingPerson] = await tx.select({ id: person.id }).from(person).where(eq(person.externalRef, externalRef)).limit(1);
      let personId: string;
      let studentProfileId: string | undefined;
      let staffProfileId: string | undefined;
      let userAccountId: string | null;
      // Primary school of staff (scope anchor, docs/admin.md): the school of the first school role, else of the
      // first taught offering (`<school code>:<class>:<subject>`); organization admins stay unanchored.
      const staffSchoolId = p.kind === "staff" ? demoStaffSchoolId(p, schoolIds) : null;
      if (existingPerson) {
        personId = existingPerson.id;
        await updatePerson(tx, ctx, personId, { firstName: p.firstName, lastName: p.lastName, gender: p.gender, status: "active", ...(p.kind === "staff" ? { schoolId: staffSchoolId } : {}) });
        if (p.kind === "student") {
          const [sp] = await tx.select({ id: studentProfile.id }).from(studentProfile).where(eq(studentProfile.personId, personId)).limit(1);
          studentProfileId = sp.id;
        } else {
          const [st] = await tx.select({ id: staffProfile.id }).from(staffProfile).where(eq(staffProfile.personId, personId)).limit(1);
          staffProfileId = st.id;
        }
        const account = await findAccountOfPerson(tx, personId);
        userAccountId = account?.userAccountId ?? null;
      } else if (p.kind === "student") {
        const res = await createStudent(tx, ctx, {
          id: demoId(k(`person:${p.key}`)),
          firstName: p.firstName,
          lastName: p.lastName,
          gender: p.gender,
          studentNumber: p.studentNumber!,
          externalRef,
          contactPhone: phone,
          login: { createAccount: true, identifier: phone },
        });
        personId = res.personId;
        studentProfileId = res.studentProfileId;
        userAccountId = res.userAccountId;
      } else {
        const res = await createStaff(tx, ctx, { id: demoId(k(`person:${p.key}`)), firstName: p.firstName, lastName: p.lastName, gender: p.gender, phone, externalRef, schoolId: staffSchoolId });
        personId = res.personId;
        staffProfileId = res.staffProfileId;
        userAccountId = res.userAccountId;
      }
      if (!userAccountId) throw new Error(`demo person ${p.key} has no account`);
      // Re-seeding RESETS the demo password (known value; kept encrypted so the credentials sheet can be printed).
      await setAccountPassword(tx, ctx, { userAccountId, password: opts.password, mustChangePassword: opts.forceChange, storeInitial: opts.forceChange });

      if (p.kind === "student") {
        studentProfileIds.push(studentProfileId!);
      } else {
        for (const r of p.roles) {
          if (r.scope !== "class_offering") continue;
          const classOfferingId = offeringIds[r.offering];
          if (!classOfferingId) throw new Error(`unresolved offering for ${p.key}: ${r.offering}`);
          teacherPlans.push({ staffProfileId: staffProfileId!, classOfferingId });
        }
      }

      for (const r of p.roles) {
        // Teacher roles are DERIVED from academic.teacher_assignment by the academic service (below), not inserted here.
        if (r.scope === "class_offering") continue;
        if (r.scope === "organization") await assignRole(tx, ctx, { personId, roleCode: r.role as "org_admin" });
        else if (r.scope === "school") await assignRole(tx, ctx, { personId, roleCode: r.role as "school_principal" | "vice_principal", schoolId: schoolIds[r.school] });
        else await assignRole(tx, ctx, { personId, roleCode: "student", studentProfileId });
      }

      logins.push({ org: spec.name, name: `${p.firstName} ${p.lastName}`, label: p.label, phone });
    }

    // ---- enrollments + teacher assignments: through the academic service, so the derived rows come from the service ----
    const svcCtx: ServiceCtx = ctx;

    // Step 1's seed hand-inserted the teacher role_assignments with source_type = 'teacher_assignment' and no
    // source_id; the real rows below carry source_id = teacher_assignment.id. Drop the legacy ones (no-op afterwards).
    await tx.delete(roleAssignment).where(and(eq(roleAssignment.sourceType, "teacher_assignment"), isNull(roleAssignment.sourceId)));

    // Demo roles and enrollments must be valid on the day the demo runs, even before the academic year starts
    // (۱ مهر ۱۴۰۵ = 2026-09-23): start them at min(today, year start). Also backfill rows written by an earlier run.
    const demoStart = new Date().toISOString().slice(0, 10) < "2026-09-23" ? new Date().toISOString().slice(0, 10) : "2026-09-23";
    await tx.execute(sql`update academic.teacher_assignment set valid_from = least(valid_from, ${demoStart}::date) where valid_to is null`);
    await tx.execute(sql`update iam.role_assignment set valid_from = least(valid_from, ${demoStart}::date) where source_type = 'teacher_assignment' and revoked_at is null`);
    await tx.execute(sql`update academic.class_enrollment set starts_on = least(starts_on, ${demoStart}::date) where status = 'active' and ends_on is null`);
    await tx.execute(sql`update academic.school_enrollment set starts_on = least(starts_on, ${demoStart}::date) where status = 'active' and ends_on is null`);

    const classGroupId = classIds[spec.studentClass];
    if (!classGroupId) throw new Error(`unresolved student class ${spec.studentClass}`);
    for (const studentProfileId of studentProfileIds) {
      const active = await tx
        .select({ id: classEnrollment.id })
        .from(classEnrollment)
        .where(and(eq(classEnrollment.studentProfileId, studentProfileId), eq(classEnrollment.status, "active")))
        .limit(1);
      if (active.length === 0) await enrollStudent(tx, svcCtx, { studentProfileId, classGroupId, startsOn: demoStart });
    }

    for (const plan of teacherPlans) {
      const existing = await tx
        .select({ id: teacherAssignment.id })
        .from(teacherAssignment)
        .where(
          and(
            eq(teacherAssignment.staffProfileId, plan.staffProfileId),
            eq(teacherAssignment.classOfferingId, plan.classOfferingId),
            eq(teacherAssignment.role, "main"),
            isNull(teacherAssignment.validTo),
          ),
        )
        .limit(1);
      if (existing.length === 0) await assignTeacher(tx, svcCtx, { ...plan, role: "main", validFrom: demoStart });
    }

    const count = async (table: string, where = ""): Promise<number> => {
      const res = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table} ${where}`));
      return res.rows[0].n;
    };
    const counts: DemoCounts = {
      ...(await structureCounts(tx)),
      persons: await count("iam.person"),
      accounts: await count("iam.organization_membership"),
      roleAssignments: await count("iam.role_assignment", "where revoked_at is null"),
      schoolEnrollments: await count("academic.school_enrollment"),
      classEnrollments: await count("academic.class_enrollment", "where status = 'active'"),
      teacherAssignments: await count("academic.teacher_assignment", "where valid_to is null"),
      derivedTeacherRoles: await count("iam.role_assignment", "where source_type = 'teacher_assignment' and revoked_at is null"),
    };
    return { logins, counts };
  });
}

export async function seedDemo(
  db: Db,
  roleIds: Record<string, string>,
): Promise<{ logins: DemoLogin[]; password: string; generated: boolean; counts: Record<string, DemoCounts> }> {
  const envPassword = process.env.SEED_DEMO_PASSWORD;
  const password = envPassword && envPassword.length >= 8 ? envPassword : generateInitialPassword();
  const forceChange = process.env.SEED_DEMO_NO_FORCE !== "1";
  const a = await seedDemoOrg(db, DANESH, { password, forceChange, roleIds, phoneOffset: 1 });
  const b = await seedDemoOrg(db, NOOR, { password, forceChange, roleIds, phoneOffset: 101 });
  return { logins: [...a.logins, ...b.logins], password, generated: !envPassword, counts: { [DANESH.slug]: a.counts, [NOOR.slug]: b.counts } };
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

const faDigits = (s: string) => s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

function printLogins(logins: DemoLogin[], password: string, generated: boolean, forceChange: boolean): void {
  const width = Math.max(...logins.map((l) => l.name.length), 4) + 2;
  const labelWidth = Math.max(...logins.map((l) => l.label.length), 4) + 2;
  console.log("\nحساب‌های دمو (ورود با شمارهٴ موبایل):");
  console.log(`${"نام".padEnd(width)}${"نقش".padEnd(labelWidth)}${"موبایل".padEnd(16)}سازمان`);
  console.log("-".repeat(width + labelWidth + 16 + 14));
  for (const l of logins) console.log(`${l.name.padEnd(width)}${l.label.padEnd(labelWidth)}${faDigits(l.phone).padEnd(16)}${l.org}`);
  console.log(`\nرمز همهٴ حساب‌های دمو${generated ? " (تصادفی؛ فقط این‌جا چاپ می‌شود)" : " (از SEED_DEMO_PASSWORD)"}: ${password}`);
  console.log(forceChange ? "در اولین ورود تغییر رمز اجباری است." : "SEED_DEMO_NO_FORCE=1 — تغییر رمز اجباری نیست.");
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
      : Object.fromEntries((await db.select({ code: role.code, id: role.id }).from(role).where(and(isNull(role.organizationId), inArray(role.code, SYSTEM_ROLE_CODES)))).map((r) => [r.code, r.id]));
    if (doCatalog) console.log(formatCatalogSummary(await catalogCounts(db)));
    if (doDemo) {
      const { logins, password, generated, counts } = await seedDemo(db, roleIds);
      console.log(`[seed] demo: ${logins.length} accounts in 2 organizations`);
      for (const [slug, c] of Object.entries(counts)) {
        console.log(
          `[seed] demo ${slug}: ${c.school} schools, ${c.classGroup} classes, ${c.classOffering} offerings, ${c.persons} persons, ${c.accounts} accounts, ${c.roleAssignments} role assignments, ${c.schoolEnrollments} school enrollments, ${c.classEnrollments} active class enrollments, ${c.teacherAssignments} teacher assignments, ${c.derivedTeacherRoles} derived teacher roles`,
        );
      }
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
