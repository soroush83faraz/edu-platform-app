// Pilot dataset: THREE separate organizations (tenants), each one real-feeling school with a full year of structure,
// ~40 staff and ~550 students in total, and a living کارتابل (tasks by every teacher, student comments and «انجام شد»,
// staff todos, admin tasks) — so the product can be exercised with many users and cross-tenant isolation.
//
//   pnpm seed:pilot                      (runs the catalog seed first; refuses in production unless SEED_ALLOW=1)
//   pnpm seed:pilot --reset              (deletes ONLY the three pilot organizations — every tenant row of
//                                         allameh/farzanegan/helli plus their global accounts, identities and
//                                         sessions — prints the counts, then re-seeds; other organizations untouched)
//   PILOT_PASSWORD=…  one shared password for every pilot account (default Pilot-1405-pass; must_change_password = false)
//   PILOT_SCALE=0.2   fewer students per class / tasks per teacher (the int test uses it)
//
// Like scripts/seed.ts it runs as app_owner (MIGRATION_DATABASE_URL) with its OWN pool and sets the tenant context
// itself (`set_config` is allowed under scripts/). Everything that has a service goes THROUGH the service with a
// REAL ctx of the acting person (assignments loaded from the database with `listValidAssignments`, as
// scripts/import.ts does): the organization admin builds structure and people, every teacher creates their own
// tasks, every student comments / marks done under their own student role. Only the shared password is applied
// with a direct UPDATE (one precomputed argon2 hash instead of ~600 extra hashes).
//
// Deterministic and idempotent: ids are sha256("edu-pilot:"+key) (v7-shaped, like demoId), phones live in one block
// per school (+9893510xxxxx ALK, +9893520xxxxx FRZ, +9893530xxxxx HL4 — never the demo block), names come from the
// built-in lists below. Every entity is looked up by its natural key first, so a second run inserts nothing
// (`pilotCounts` is identical; tests/int/seed-pilot.test.ts asserts it). Existing accounts keep their password.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { assignTeacher } from "../src/modules/academic/service";
import type { Assignment } from "../src/modules/iam/can";
import { hashPassword } from "../src/modules/iam/password";
import { IMPLICIT_PERMISSIONS, PERMISSIONS } from "../src/modules/iam/permissions";
import { listValidAssignments } from "../src/modules/iam/repo";
import { createStaff, createStudent, findAccountOfPerson, type IamCtx } from "../src/modules/iam/service";
import { findAcademicYearByName, findClassGroupByName, findDefaultBranch, findEducationLevelByCode, findGradeLevelByCode, findOffering, findSchoolByCode, findSubjectByCode } from "../src/modules/tenancy/repo";
import {
  createAcademicYear,
  createClassGroup,
  createClassOffering,
  createEducationLevel,
  createGradeLevel,
  createSchool,
  createSubject,
  updateBranch,
  upsertTerm,
} from "../src/modules/tenancy/service";
import { addComment, changeStatus, createWorkItem, type WorkspaceCtx } from "../src/modules/workspace/service";
import { seedCatalog } from "./seed";

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const { organization, person, staffProfile, role, authIdentity, userAccount, teacherAssignment, workItem, workItemAssignee, workItemComment } = schema;

// ---------------------------------------------------------------------------------------------------------------
// deterministic helpers
// ---------------------------------------------------------------------------------------------------------------

/** Deterministic UUID (v7-shaped, not time-ordered) from a stable key. */
export function pilotId(key: string): string {
  const h = createHash("sha256").update(`edu-pilot:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Stable pseudo-random integer in [0, mod) from a key (spreads choices without Math.random). */
export function hashInt(key: string, mod: number): number {
  const h = createHash("sha256").update(`edu-pilot:${key}`).digest();
  return h.readUInt32BE(0) % mod;
}

/** `+98935<block><5 digits>`: 10 = ALK, 20 = FRZ, 30 = HL4. */
export const pilotPhone = (block: number, n: number): string => `+98935${block}${String(n).padStart(5, "0")}`;

export const PILOT_DEFAULT_PASSWORD = "Pilot-1405-pass";

// ---------------------------------------------------------------------------------------------------------------
// names (built in; ≥ 60 first names per gender, ≥ 80 family names)
// ---------------------------------------------------------------------------------------------------------------

export const MALE_NAMES = [
  "علی", "محمد", "حسین", "رضا", "امیر", "مهدی", "حسن", "محمدرضا", "امیرحسین", "سجاد", "سعید", "حامد", "عرفان", "پارسا", "آرش", "آرمان",
  "بابک", "بهنام", "بهزاد", "پویا", "پیمان", "جواد", "دانیال", "داوود", "رامین", "رسول", "سامان", "سینا", "شهاب", "صادق", "عباس", "عرشیا",
  "فرهاد", "فرزاد", "کامران", "کیارش", "کیان", "ماهان", "مبین", "متین", "مجید", "محسن", "مرتضی", "مسعود", "مصطفی", "مهران", "میلاد", "نیما",
  "هادی", "هومن", "یاسین", "یوسف", "ابوالفضل", "احسان", "احمد", "اشکان", "افشین", "امین", "ایمان", "بردیا", "پدرام", "پوریا", "حمید", "خشایار",
  "رادین", "رهام", "سهیل", "شایان", "طاها", "عادل", "علیرضا", "فربد", "کوروش", "مانی", "محمدامین", "محمدحسین", "مهرداد", "نوید", "وحید", "هیراد",
];

export const FEMALE_NAMES = [
  "فاطمه", "زهرا", "مریم", "سارا", "نرگس", "مهسا", "نگار", "الهام", "پریسا", "ریحانه", "یاسمن", "مینا", "هستی", "سحر", "نیلوفر", "آیدا",
  "آناهیتا", "آرزو", "بهار", "بهاره", "پرنیان", "پریا", "ترانه", "تینا", "حدیث", "حنانه", "درسا", "دنیا", "رها", "روژان", "زینب", "ستایش",
  "سمانه", "سوگند", "شقایق", "شیدا", "شیرین", "صبا", "غزل", "غزاله", "فرشته", "فرناز", "کیانا", "گلناز", "لیلا", "مبینا", "محدثه", "مرضیه",
  "ملیکا", "مهدیه", "مهتاب", "مهرناز", "نازنین", "ندا", "نسترن", "نسیم", "نگین", "نیایش", "نیکا", "هانیه", "هدیه", "هلیا", "یگانه", "آوا",
  "الناز", "الینا", "آتنا", "پگاه", "رومینا", "سپیده", "شادی", "طناز", "عسل", "مائده", "مهلا", "نرجس", "نهال", "ویدا", "هانا", "پانیذ",
];

export const FAMILY_NAMES = [
  "محمدی", "حسینی", "احمدی", "رضایی", "موسوی", "کریمی", "جعفری", "صادقی", "حیدری", "رحیمی", "قاسمی", "نوری", "عباسی", "طاهری", "زارعی", "باقری",
  "شریفی", "کاظمی", "هاشمی", "اکبری", "امینی", "ابراهیمی", "اسماعیلی", "افشار", "امیری", "بهرامی", "پورمحمدی", "توکلی", "جلالی", "جوادی", "خسروی", "خلیلی",
  "داوودی", "دهقان", "رستمی", "رنجبر", "زمانی", "سلطانی", "سلیمانی", "شاهی", "شکوهی", "شمس", "صالحی", "صفری", "ظفری", "عزیزی", "علوی", "علیزاده",
  "غفاری", "فتحی", "فرجی", "فلاح", "قادری", "قنبری", "کاویانی", "کمالی", "کیانی", "گودرزی", "لطفی", "مجیدی", "مرادی", "مظفری", "معینی", "ملکی",
  "منصوری", "مهدوی", "میرزایی", "نادری", "نجفی", "نظری", "نعمتی", "نیک‌خواه", "واحدی", "وکیلی", "هدایتی", "همتی", "یزدانی", "یوسفی", "یعقوبی", "سعیدی",
  "فروغی", "تهرانی", "اصفهانی", "شیرازی", "رشیدی", "اردکانی", "پاکدل", "بختیاری",
];

type Gender = "female" | "male";

/**
 * Deterministic full name for the n-th person of a group: coprime strides over both lists keep every pair unique
 * for the first 240 persons of a group (lcm of the list sizes is far larger), so a class never holds two
 * identical names.
 */
export function pilotName(gender: Gender, group: string, n: number): { firstName: string; lastName: string } {
  const first = gender === "male" ? MALE_NAMES : FEMALE_NAMES;
  const a = hashInt(`${group}:first`, first.length);
  const b = hashInt(`${group}:last`, FAMILY_NAMES.length);
  return { firstName: first[(a + 7 * n) % first.length], lastName: FAMILY_NAMES[(b + 13 * n) % FAMILY_NAMES.length] };
}

// ---------------------------------------------------------------------------------------------------------------
// the three schools
// ---------------------------------------------------------------------------------------------------------------

export interface PilotSubject {
  code: string;
  name: string;
}

export interface PilotClass {
  name: string;
  grade: string;
  /** Subject codes offered in نوبت اول. */
  subjects: string[];
}

export interface PilotTeacherSpec {
  /** Subjects this teacher can take, in preference order (the allocator balances offerings to 4–6 per teacher). */
  subjects: string[];
}

export interface PilotOrgSpec {
  key: string;
  name: string;
  slug: string;
  /** Phone block digit pair after +98935. */
  phoneBlock: number;
  school: { code: string; name: string; gender: "girls" | "boys"; branchName: string };
  level: { code: string; name: string };
  grades: Array<{ code: string; name: string; seq: number }>;
  subjects: PilotSubject[];
  classes: PilotClass[];
  teachers: PilotTeacherSpec[];
  adminGender: Gender;
}

const SEC2_SUBJECTS: PilotSubject[] = [
  { code: "MATH", name: "ریاضی" },
  { code: "PHYS", name: "فیزیک" },
  { code: "CHEM", name: "شیمی" },
  { code: "BIO", name: "زیست‌شناسی" },
  { code: "LIT", name: "ادبیات فارسی" },
  { code: "ARAB", name: "عربی" },
  { code: "ENG", name: "زبان انگلیسی" },
  { code: "REL", name: "دین و زندگی" },
  { code: "HIST", name: "تاریخ" },
  { code: "PE", name: "تربیت بدنی" },
];

const SEC1_SUBJECTS: PilotSubject[] = [
  { code: "MATH", name: "ریاضی" },
  { code: "SCI", name: "علوم تجربی" },
  { code: "LIT", name: "ادبیات فارسی" },
  { code: "ARAB", name: "عربی" },
  { code: "ENG", name: "زبان انگلیسی" },
  { code: "REL", name: "پیام‌های آسمان" },
  { code: "SOC", name: "مطالعات اجتماعی" },
  { code: "TECH", name: "کار و فناوری" },
  { code: "PE", name: "تربیت بدنی" },
];

const SEC2_GRADES = [
  { code: "G10", name: "دهم", seq: 1 },
  { code: "G11", name: "یازدهم", seq: 2 },
  { code: "G12", name: "دوازدهم", seq: 3 },
];
const SEC1_GRADES = [
  { code: "G7", name: "هفتم", seq: 1 },
  { code: "G8", name: "هشتم", seq: 2 },
  { code: "G9", name: "نهم", seq: 3 },
];

const SEC2_CORE = ["MATH", "LIT", "ARAB", "ENG", "REL"];
const sec2Class = (name: string, grade: string, extra: string[]): PilotClass => ({ name, grade, subjects: [...SEC2_CORE, ...extra] });
const SEC1_CORE = ["MATH", "SCI", "LIT", "ARAB", "ENG", "REL"];
const sec1Class = (name: string, grade: string, extra: string[]): PilotClass => ({ name, grade, subjects: [...SEC1_CORE, ...extra] });

/** Teacher rosters: ten teachers per school, each with a primary and (mostly) a secondary subject. */
const SEC2_TEACHERS: PilotTeacherSpec[] = [
  { subjects: ["MATH"] },
  { subjects: ["MATH", "PHYS"] },
  { subjects: ["PHYS", "CHEM"] },
  { subjects: ["CHEM", "BIO"] },
  { subjects: ["BIO", "REL"] },
  { subjects: ["LIT"] },
  { subjects: ["LIT", "ARAB"] },
  { subjects: ["ARAB", "REL"] },
  { subjects: ["ENG"] },
  { subjects: ["ENG", "REL"] },
];

export const ALLAMEH: PilotOrgSpec = {
  key: "alk",
  name: "مجتمع آموزشی علامه طباطبایی",
  slug: "allameh",
  phoneBlock: 10,
  school: { code: "ALK", name: "علامه طباطبایی — شعبهٴ کارگر", gender: "boys", branchName: "کارگر" },
  level: { code: "SEC2", name: "متوسطهٴ دوم" },
  grades: SEC2_GRADES,
  subjects: SEC2_SUBJECTS,
  classes: [
    sec2Class("۱۰/۱", "G10", ["PHYS", "CHEM"]),
    sec2Class("۱۰/۲", "G10", ["PHYS", "CHEM"]),
    sec2Class("۱۰/۳", "G10", ["PHYS", "CHEM"]),
    sec2Class("۱۱/۱", "G11", ["PHYS", "CHEM", "BIO"]),
    sec2Class("۱۱/۲", "G11", ["PHYS", "CHEM", "BIO"]),
    sec2Class("۱۲/۱", "G12", ["PHYS", "CHEM", "BIO"]),
    sec2Class("۱۲/۲", "G12", ["PHYS", "CHEM", "BIO"]),
  ],
  teachers: SEC2_TEACHERS,
  adminGender: "male",
};

export const FARZANEGAN: PilotOrgSpec = {
  key: "frz",
  name: "فرزانگان",
  slug: "farzanegan",
  phoneBlock: 20,
  school: { code: "FRZ", name: "فرزانگان", gender: "girls", branchName: "مرکزی" },
  level: { code: "SEC1", name: "متوسطهٴ اول" },
  grades: SEC1_GRADES,
  subjects: SEC1_SUBJECTS,
  classes: [
    sec1Class("۷/۱", "G7", ["SOC", "TECH"]),
    sec1Class("۷/۲", "G7", ["SOC", "PE"]),
    sec1Class("۷/۳", "G7", ["SOC", "TECH"]),
    sec1Class("۸/۱", "G8", ["SOC", "TECH"]),
    sec1Class("۸/۲", "G8", ["SOC", "PE"]),
    sec1Class("۹/۱", "G9", ["SOC", "TECH"]),
    sec1Class("۹/۲", "G9", ["SOC", "PE"]),
  ],
  teachers: [
    { subjects: ["MATH"] },
    { subjects: ["MATH", "SCI"] },
    { subjects: ["SCI", "TECH"] },
    { subjects: ["LIT"] },
    { subjects: ["LIT", "ARAB"] },
    { subjects: ["ARAB", "REL"] },
    { subjects: ["ENG"] },
    { subjects: ["REL", "SOC"] },
    { subjects: ["SOC", "TECH"] },
    { subjects: ["PE", "ENG", "SOC"] },
  ],
  adminGender: "female",
};

export const HELLI: PilotOrgSpec = {
  key: "hl4",
  name: "حلی",
  slug: "helli",
  phoneBlock: 30,
  school: { code: "HL4", name: "حلی ۴", gender: "boys", branchName: "مرکزی" },
  level: { code: "SEC2", name: "متوسطهٴ دوم" },
  grades: SEC2_GRADES,
  subjects: SEC2_SUBJECTS,
  classes: [
    sec2Class("۱۰/۱", "G10", ["PHYS", "CHEM"]),
    sec2Class("۱۰/۲", "G10", ["PHYS", "CHEM"]),
    sec2Class("۱۰/۳", "G10", ["PHYS", "CHEM"]),
    sec2Class("۱۱/۱", "G11", ["CHEM", "BIO"]),
    sec2Class("۱۱/۲", "G11", ["CHEM", "BIO"]),
    sec2Class("۱۱/۳", "G11", ["CHEM", "BIO"]),
    sec2Class("۱۲/۱", "G12", ["PHYS", "BIO"]),
    sec2Class("۱۲/۲", "G12", ["PHYS", "BIO"]),
  ],
  teachers: SEC2_TEACHERS,
  adminGender: "male",
};

export const PILOT_ORGS: PilotOrgSpec[] = [ALLAMEH, FARZANEGAN, HELLI];

/**
 * `<class>:<subject>` offering keys per teacher index. Greedy placement (most constrained offerings first, each on
 * the capable teacher with the fewest offerings; ties → the teacher whose primary subject it is), then a
 * balancing pass that moves offerings off the most loaded teacher along chains of up to three capable teachers
 * until the spread is ≤ 1 — with the rosters above every teacher ends at 4–6 offerings.
 */
export function allocateOfferings(spec: PilotOrgSpec): string[][] {
  const owner = new Map<string, number>();
  const offerings: Array<{ key: string; code: string; capable: number[] }> = [];
  for (const cls of spec.classes) {
    for (const code of cls.subjects) {
      const capable = spec.teachers.flatMap((t, i) => (t.subjects.includes(code) ? [i] : []));
      if (capable.length === 0) throw new Error(`pilot ${spec.key}: no teacher for ${code}`);
      offerings.push({ key: `${cls.name}:${code}`, code, capable });
    }
  }
  const load = (i: number) => [...owner.values()].filter((v) => v === i).length;
  const sorted = [...offerings].sort((a, b) => a.capable.length - b.capable.length);
  for (const o of sorted) {
    let best = o.capable[0];
    for (const i of o.capable) {
      const primary = spec.teachers[i].subjects[0] === o.code;
      const bestPrimary = spec.teachers[best].subjects[0] === o.code;
      if (load(i) < load(best) || (load(i) === load(best) && primary && !bestPrimary)) best = i;
    }
    owner.set(o.key, best);
  }
  // Balance: move one offering from the heaviest teacher to a teacher at least two lighter, directly or through
  // one or two intermediate teachers (each hop hands over an offering the next teacher is capable of).
  const byKey = new Map(offerings.map((o) => [o.key, o]));
  const tryMove = (from: number, target: number, depth: number, visited: Set<number>): boolean => {
    for (const [key, who] of owner) {
      if (who !== from) continue;
      for (const to of byKey.get(key)!.capable) {
        if (to === from || visited.has(to)) continue;
        if (load(to) <= target) {
          owner.set(key, to);
          return true;
        }
        if (depth > 0 && load(to) === target + 1 && tryMove(to, target, depth - 1, new Set([...visited, to]))) {
          owner.set(key, to);
          return true;
        }
      }
    }
    return false;
  };
  for (let guard = 0; guard < 200; guard++) {
    const loads = spec.teachers.map((_t, i) => load(i));
    const max = Math.max(...loads);
    const min = Math.min(...loads);
    if (max - min <= 1) break;
    const heavy = loads.indexOf(max);
    if (!tryMove(heavy, max - 2, 2, new Set([heavy]))) break;
  }
  return spec.teachers.map((_t, i) => offerings.filter((o) => owner.get(o.key) === i).map((o) => o.key));
}

// ---------------------------------------------------------------------------------------------------------------
// plan (scale-aware numbers the int test asserts)
// ---------------------------------------------------------------------------------------------------------------

export interface PilotOptions {
  password: string;
  /** 1 = the real pilot (25 students per class, 2–4 tasks per teacher); the int test scales down. */
  scale: number;
  roleIds: Record<string, string>;
}

export function studentsPerClass(scale: number): number {
  return Math.max(2, Math.round(25 * scale));
}

/** Tasks the t-th teacher of a school creates: 2, 3, 4, 2, … at full scale; at least one when scaled down. */
export function tasksOfTeacher(t: number, scale: number): number {
  const full = 2 + (t % 3);
  return Math.max(1, Math.round(full * scale));
}

/** Personal todos the principal and the vice principal create (each). */
const STAFF_TODOS = [
  "تماس با اولیای غایبان این هفته",
  "آماده‌سازی برنامهٴ امتحانات نوبت اول",
  "بازدید از کلاس‌ها — گزارش هفتگی",
];
/** Tasks the principal sends to every teacher of the school. */
const ADMIN_TASKS = ["ثبت نمرات مستمر تا پایان هفته", "تکمیل فرم اطلاعات کلاسی"];

export interface ExpectedCounts {
  organizations: number;
  schools: number;
  classGroups: number;
  offerings: number;
  teachers: number;
  students: number;
  workItems: number;
}

export function expectedCounts(scale: number): ExpectedCounts {
  let classGroups = 0;
  let offerings = 0;
  let teachers = 0;
  let students = 0;
  let workItems = 0;
  for (const spec of PILOT_ORGS) {
    classGroups += spec.classes.length;
    offerings += spec.classes.reduce((n, c) => n + c.subjects.length, 0);
    teachers += spec.teachers.length;
    students += spec.classes.length * studentsPerClass(scale);
    workItems += spec.teachers.reduce((n, _t, i) => n + tasksOfTeacher(i, scale), 0) + 2 * STAFF_TODOS.length + ADMIN_TASKS.length;
  }
  return { organizations: PILOT_ORGS.length, schools: PILOT_ORGS.length, classGroups, offerings, teachers, students, workItems };
}

// ---------------------------------------------------------------------------------------------------------------
// seeding
// ---------------------------------------------------------------------------------------------------------------

const ALL_ROLE_PERMS = PERMISSIONS.map((p) => p.code).filter((c) => !IMPLICIT_PERMISSIONS.includes(c));

interface ActorCtx extends IamCtx, WorkspaceCtx {
  orgId: string;
  personId: string;
  assignments: Assignment[];
}

interface StaffOut {
  personId: string;
  staffProfileId: string;
  name: string;
  phone: string;
}

export interface TeacherOut extends StaffOut {
  offerings: string[];
}

export interface StudentOut {
  personId: string;
  name: string;
  loginIdentifier: string;
}

export interface SchoolSummary {
  org: string;
  school: string;
  code: string;
  admin: StaffOut;
  principal: StaffOut;
  vice: StaffOut;
  teachers: TeacherOut[];
  classes: Array<{ name: string; students: StudentOut[] }>;
  counts: Record<string, number>;
}

async function withOrg<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/** The real assignments of a person, as a full service ctx (`listValidAssignments`, like scripts/import.ts). */
async function actorCtx(tx: Tx, orgId: string, personId: string, cache: Map<string, ActorCtx>): Promise<ActorCtx> {
  const hit = cache.get(personId);
  if (hit) return hit;
  const account = await findAccountOfPerson(tx, personId);
  const assignments = await listValidAssignments(tx, personId);
  if (assignments.length === 0) throw new Error(`pilot: person ${personId} has no valid role assignment`);
  const ctx: ActorCtx = { orgId, personId, userId: account?.userAccountId ?? null, requestId: "seed-pilot", userAgent: "scripts/seed-pilot.ts", assignments };
  cache.set(personId, ctx);
  return ctx;
}

/** The ONE shared pilot password: precomputed hash, no `initial_password_enc`, no forced change. */
async function applyPilotPassword(tx: Tx, userAccountId: string, secretHash: string): Promise<void> {
  await tx.update(authIdentity).set({ secretHash, initialPasswordEnc: null }).where(and(eq(authIdentity.userAccountId, userAccountId), eq(authIdentity.provider, "password")));
  await tx.update(userAccount).set({ mustChangePassword: false }).where(eq(userAccount.id, userAccountId));
}

async function findPersonByRef(tx: Tx, externalRef: string): Promise<{ id: string; firstName: string; lastName: string } | null> {
  const [row] = await tx.select({ id: person.id, firstName: person.firstName, lastName: person.lastName }).from(person).where(eq(person.externalRef, externalRef)).limit(1);
  return row ?? null;
}

interface StaffPlan {
  key: string;
  gender: Gender;
  phone: string;
  schoolId: string | null;
  roles: Array<{ roleCode: "org_admin" | "school_principal" | "vice_principal"; schoolId?: string | null }>;
}

/** Staff by natural key `pilot:<org>:<key>` (external_ref) → existing, else `createStaff` + roles. */
async function ensureStaff(tx: Tx, ctx: IamCtx, spec: PilotOrgSpec, plan: StaffPlan, name: { firstName: string; lastName: string }, secretHash: string, out: { created: number }): Promise<StaffOut> {
  const externalRef = `pilot:${spec.key}:${plan.key}`;
  const existing = await findPersonByRef(tx, externalRef);
  if (existing) {
    const [st] = await tx.select({ id: staffProfile.id }).from(staffProfile).where(eq(staffProfile.personId, existing.id)).limit(1);
    return { personId: existing.id, staffProfileId: st.id, name: `${existing.firstName} ${existing.lastName}`, phone: plan.phone };
  }
  const res = await createStaff(tx, ctx, {
    id: pilotId(`${spec.key}:person:${plan.key}`),
    firstName: name.firstName,
    lastName: name.lastName,
    gender: plan.gender,
    phone: plan.phone,
    externalRef,
    schoolId: plan.schoolId,
    roles: plan.roles,
  });
  if (!res.userAccountId) throw new Error(`pilot: staff ${plan.key} has no account`);
  await applyPilotPassword(tx, res.userAccountId, secretHash);
  out.created++;
  return { personId: res.personId, staffProfileId: res.staffProfileId, name: `${name.firstName} ${name.lastName}`, phone: plan.phone };
}

const faDigits = (s: string | number) => String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

const COMMENT_VARIANTS = ["انجام دادم.", "انجام شد، ممنون.", "تمرین‌ها را حل کردم.", "انجام دادم استاد؛ فقط سؤال آخر را نفهمیدم.", "تمام شد."];
const TASK_TEMPLATES: Array<{ title: (subject: string, cls: string, n: number) => string; description: string }> = [
  { title: (s, c, n) => `تمرین‌های فصل ${faDigits(n)} — ${s} ${c}`, description: "تمرین‌های آخر فصل را در دفتر حل کنید و برای جلسهٴ بعد بیاورید." },
  { title: (s, c, n) => `پیش‌مطالعهٴ درس ${faDigits(n)} — ${s} ${c}`, description: "درس بعدی را پیش از کلاس بخوانید و سه پرسش دربارهٴ آن بنویسید." },
  { title: (s, c) => `آزمون کلاسی ${s} ${c}`, description: "آزمون ده‌دقیقه‌ای از مباحث دو هفتهٴ گذشته." },
  { title: (s, c) => `تحقیق و ارائه — ${s} ${c}`, description: "یک موضوع از فهرست کلاس انتخاب کنید و ارائهٴ پنج‌دقیقه‌ای آماده کنید." },
];
/** Due-date spread in days from today (null = no due date): overdue 1–3 days, today, this week, later. */
const DUE_OFFSETS: Array<number | null> = [-2, 0, 3, null, 1, -1, 6, 0, 12, -3, 2, null, 5, 0, 4, -1, 20, 3];

function dueAt(offsetDays: number | null): Date | null {
  if (offsetDays === null) return null;
  // 17:30 Asia/Tehran (14:00 UTC) on the target calendar day.
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

async function findWorkItemByTitle(tx: Tx, creatorPersonId: string, title: string): Promise<string | null> {
  const [row] = await tx.select({ id: workItem.id }).from(workItem).where(and(eq(workItem.createdByPersonId, creatorPersonId), eq(workItem.title, title))).limit(1);
  return row?.id ?? null;
}

async function seedPilotOrg(db: Db, spec: PilotOrgSpec, opts: PilotOptions, secretHash: string): Promise<SchoolSummary> {
  const orgId = pilotId(`org:${spec.key}`);
  const k = (s: string) => `${spec.key}:${s}`;
  const perClass = studentsPerClass(opts.scale);
  const created = { created: 0 };
  const phase: Record<string, number> = {};
  let mark = Date.now();
  const lap = (name: string) => {
    phase[name] = Date.now() - mark;
    mark = Date.now();
  };

  // Global row: no RLS.
  await db.insert(organization).values({ id: orgId, name: spec.name, slug: spec.slug, status: "active" }).onConflictDoNothing({ target: organization.slug });

  // The bootstrap ctx ACTS AS the organization admin whose person row is created first with this very id
  // (the same organization-scoped org_admin assignment a real login of theirs would carry).
  const adminPersonId = pilotId(k("person:admin"));
  const bootstrap: IamCtx = {
    orgId,
    personId: adminPersonId,
    userId: null,
    requestId: "seed-pilot",
    assignments: [{ roleCode: "org_admin", roleId: opts.roleIds.org_admin, scopeType: "organization", scopeId: orgId, permissions: ALL_ROLE_PERMS }],
  };
  const ctxCache = new Map<string, ActorCtx>();

  // ---- 1. admin + structure + staff + teaching (one transaction) ----
  const structure = await withOrg(db, orgId, async (tx) => {
    const admin = await ensureStaff(
      tx,
      bootstrap,
      spec,
      { key: "admin", gender: spec.adminGender, phone: pilotPhone(spec.phoneBlock, 1), schoolId: null, roles: [{ roleCode: "org_admin" }] },
      pilotName(spec.adminGender, k("admin"), 0),
      secretHash,
      created,
    );
    const ctx = await actorCtx(tx, orgId, admin.personId, ctxCache);

    const levelRow = await findEducationLevelByCode(tx, spec.level.code);
    const levelId = levelRow ? levelRow.id : (await createEducationLevel(tx, ctx, { id: pilotId(k(`level:${spec.level.code}`)), name: spec.level.name, code: spec.level.code, sequence: 1 })).educationLevelId;

    const gradeIds: Record<string, string> = {};
    for (const g of spec.grades) {
      const existing = await findGradeLevelByCode(tx, g.code);
      gradeIds[g.code] = existing ? existing.id : (await createGradeLevel(tx, ctx, { id: pilotId(k(`grade:${g.code}`)), educationLevelId: levelId, name: g.name, code: g.code, sequence: g.seq })).gradeLevelId;
    }
    const subjectIds: Record<string, string> = {};
    const subjectNames: Record<string, string> = {};
    for (const s of spec.subjects) {
      const existing = await findSubjectByCode(tx, s.code);
      subjectIds[s.code] = existing ? existing.id : (await createSubject(tx, ctx, { id: pilotId(k(`subject:${s.code}`)), name: s.name, code: s.code })).subjectId;
      subjectNames[s.code] = s.name;
    }

    const existingSchool = await findSchoolByCode(tx, spec.school.code);
    let schoolId: string;
    let branchId: string;
    if (existingSchool) {
      schoolId = existingSchool.id;
      const br = await findDefaultBranch(tx, schoolId);
      if (!br) throw new Error(`pilot: school ${spec.school.code} has no default branch`);
      branchId = br.id;
    } else {
      const res = await createSchool(tx, ctx, { id: pilotId(k("school")), branchId: pilotId(k("branch")), name: spec.school.name, code: spec.school.code, genderPolicy: spec.school.gender, isDefault: true });
      schoolId = res.schoolId;
      branchId = res.branchId;
      if (spec.school.branchName !== "مرکزی") await updateBranch(tx, ctx, branchId, { name: spec.school.branchName });
    }

    const yearName = "۱۴۰۵-۱۴۰۶";
    const existingYear = await findAcademicYearByName(tx, schoolId, yearName);
    const yearId = existingYear
      ? existingYear.id
      : (await createAcademicYear(tx, ctx, { id: pilotId(k("year:1405")), schoolId, name: yearName, startsOn: "2026-09-23", endsOn: "2027-06-21", isCurrent: true })).academicYearId;
    const terms = [
      { seq: 1, name: "نوبت اول", startsOn: "2026-09-23", endsOn: "2027-01-20" },
      { seq: 2, name: "نوبت دوم", startsOn: "2027-01-21", endsOn: "2027-06-21" },
    ];
    const termIds: string[] = [];
    for (const t of terms) termIds.push((await upsertTerm(tx, ctx, { id: pilotId(k(`term:${t.seq}`)), academicYearId: yearId, name: t.name, sequence: t.seq, startsOn: t.startsOn, endsOn: t.endsOn })).termId);

    const classIds: Record<string, string> = {};
    const offeringIds: Record<string, string> = {};
    for (const c of spec.classes) {
      const existing = await findClassGroupByName(tx, yearId, branchId, c.name);
      classIds[c.name] = existing
        ? existing.id
        : (await createClassGroup(tx, ctx, { id: pilotId(k(`class:${c.name}`)), branchId, academicYearId: yearId, gradeLevelId: gradeIds[c.grade], name: c.name, capacity: 30 })).classGroupId;
      for (const code of c.subjects) {
        const existingOffering = await findOffering(tx, classIds[c.name], subjectIds[code], termIds[0]);
        offeringIds[`${c.name}:${code}`] = existingOffering
          ? existingOffering.id
          : (await createClassOffering(tx, ctx, { id: pilotId(k(`offering:${c.name}:${code}`)), classGroupId: classIds[c.name], subjectId: subjectIds[code], termId: termIds[0], weeklyHours: 3, status: "active" })).classOfferingId;
      }
    }

    // ---- staff: principal, vice, teachers (gender follows the school) ----
    const staffGender: Gender = spec.school.gender === "girls" ? "female" : "male";
    const principal = await ensureStaff(
      tx,
      ctx,
      spec,
      { key: "principal", gender: staffGender, phone: pilotPhone(spec.phoneBlock, 2), schoolId, roles: [{ roleCode: "school_principal", schoolId }] },
      pilotName(staffGender, k("principal"), 0),
      secretHash,
      created,
    );
    const vice = await ensureStaff(
      tx,
      ctx,
      spec,
      { key: "vice", gender: staffGender, phone: pilotPhone(spec.phoneBlock, 3), schoolId, roles: [{ roleCode: "vice_principal", schoolId }] },
      pilotName(staffGender, k("vice"), 0),
      secretHash,
      created,
    );
    const allocation = allocateOfferings(spec);
    const teachers: TeacherOut[] = [];
    for (const [t, offeringKeys] of allocation.entries()) {
      const staff = await ensureStaff(
        tx,
        ctx,
        spec,
        { key: `teacher-${t + 1}`, gender: staffGender, phone: pilotPhone(spec.phoneBlock, 11 + t), schoolId, roles: [] },
        pilotName(staffGender, k("teachers"), t),
        secretHash,
        created,
      );
      for (const key of offeringKeys) {
        const classOfferingId = offeringIds[key];
        const [existing] = await tx
          .select({ id: teacherAssignment.id })
          .from(teacherAssignment)
          .where(and(eq(teacherAssignment.staffProfileId, staff.staffProfileId), eq(teacherAssignment.classOfferingId, classOfferingId), eq(teacherAssignment.role, "main"), isNull(teacherAssignment.validTo)))
          .limit(1);
        if (!existing) await assignTeacher(tx, ctx, { staffProfileId: staff.staffProfileId, classOfferingId, role: "main" });
      }
      teachers.push({ ...staff, offerings: offeringKeys.map((key) => `${subjectNames[key.split(":")[1]]} ${key.split(":")[0]}`) });
    }
    return { admin, principal, vice, teachers, classIds, offeringIds, subjectNames, allocation };
  });

  lap("structureMs");

  // ---- 2. students: one transaction per class (25 accounts = 25 argon2 hashes each) ----
  const studentGender: Gender = spec.school.gender === "girls" ? "female" : "male";
  const classes: SchoolSummary["classes"] = [];
  let studentIndex = 0;
  for (const c of spec.classes) {
    const students: StudentOut[] = [];
    await withOrg(db, orgId, async (tx) => {
      const ctx = await actorCtx(tx, orgId, structure.admin.personId, ctxCache);
      for (let j = 0; j < perClass; j++) {
        const n = studentIndex++;
        const studentNumber = String(14051001 + n);
        const externalRef = `pilot:${spec.key}:student:${studentNumber}`;
        const name = pilotName(studentGender, k(`students:${c.name}`), j);
        const hasPhone = [true, false, true, true, false][n % 5]; // 60 % — the 2nd student of every class logs in by username
        const existing = await findPersonByRef(tx, externalRef);
        if (existing) {
          const account = await findAccountOfPerson(tx, existing.id);
          if (j < 3) students.push({ personId: existing.id, name: `${existing.firstName} ${existing.lastName}`, loginIdentifier: account?.loginIdentifier ?? "—" });
          continue;
        }
        const res = await createStudent(tx, ctx, {
          id: pilotId(k(`person:student:${studentNumber}`)),
          firstName: name.firstName,
          lastName: name.lastName,
          gender: studentGender,
          studentNumber,
          externalRef,
          contactPhone: hasPhone ? pilotPhone(spec.phoneBlock, 1000 + n) : null,
          guardianPhone: pilotPhone(spec.phoneBlock, 50000 + n),
          enrollment: { classGroupId: structure.classIds[c.name] },
          login: { createAccount: true },
        });
        if (!res.userAccountId || !res.loginIdentifier) throw new Error(`pilot: student ${studentNumber} has no account`);
        await applyPilotPassword(tx, res.userAccountId, secretHash);
        created.created++;
        if (j < 3) students.push({ personId: res.personId, name: `${name.firstName} ${name.lastName}`, loginIdentifier: res.loginIdentifier });
      }
    });
    classes.push({ name: c.name, students });
  }

  lap("studentsMs");

  // ---- 3. کارتابل: each teacher's tasks in their own transaction, students react under their own ctx ----
  let taskCounter = 0;
  for (const [t, teacher] of structure.teachers.entries()) {
    const offeringKeys = structure.allocation[t];
    await withOrg(db, orgId, async (tx) => {
      const tctx = await actorCtx(tx, orgId, teacher.personId, ctxCache);
      const n = tasksOfTeacher(t, opts.scale);
      for (let i = 0; i < n; i++) {
        const key = offeringKeys[i % offeringKeys.length];
        const [cls, code] = key.split(":");
        const tpl = TASK_TEMPLATES[(t + i) % TASK_TEMPLATES.length];
        const title = tpl.title(structure.subjectNames[code], cls, 1 + ((t + i) % 4));
        const idx = taskCounter++;
        let workItemId = await findWorkItemByTitle(tx, teacher.personId, title);
        if (!workItemId) {
          const res = await createWorkItem(tx, tctx, {
            typeCode: "task",
            title,
            description: tpl.description,
            priority: idx % 7 === 0 ? "high" : "normal",
            dueAt: dueAt(DUE_OFFSETS[idx % DUE_OFFSETS.length]),
            recipients: { kind: "class_offering", id: structure.offeringIds[key], excludePersonIds: [] },
          });
          workItemId = res.id;
        }
        // 30–50 % of the class comments and marks the task done.
        const roster = await tx
          .select({ personId: workItemAssignee.personId, state: workItemAssignee.state })
          .from(workItemAssignee)
          .where(and(eq(workItemAssignee.workItemId, workItemId), eq(workItemAssignee.role, "assignee")));
        const share = 30 + hashInt(`share:${spec.key}:${title}`, 21); // 30..50
        for (const a of roster) {
          if (hashInt(`react:${spec.key}:${title}:${a.personId}`, 100) >= share) continue;
          const sctx = await actorCtx(tx, orgId, a.personId, ctxCache);
          const [existingComment] = await tx.select({ id: workItemComment.id }).from(workItemComment).where(and(eq(workItemComment.workItemId, workItemId), eq(workItemComment.authorPersonId, a.personId))).limit(1);
          if (!existingComment) await addComment(tx, sctx, { workItemId, body: COMMENT_VARIANTS[hashInt(`comment:${title}:${a.personId}`, COMMENT_VARIANTS.length)] });
          if (a.state !== "done") await changeStatus(tx, sctx, { workItemId, toStatusCode: "done" });
        }
      }
    });
  }

  lap("teacherItemsMs");

  // ---- 4. staff todos + principal's tasks for the teachers ----
  await withOrg(db, orgId, async (tx) => {
    for (const who of [structure.principal, structure.vice]) {
      const ctx = await actorCtx(tx, orgId, who.personId, ctxCache);
      for (const [i, title] of STAFF_TODOS.entries()) {
        if (await findWorkItemByTitle(tx, who.personId, title)) continue;
        await createWorkItem(tx, ctx, { typeCode: "todo", title, priority: i === 0 ? "high" : "normal", dueAt: dueAt([1, 4, null][i] ?? null), recipients: { kind: "self" } });
      }
    }
    const pctx = await actorCtx(tx, orgId, structure.principal.personId, ctxCache);
    for (const [i, title] of ADMIN_TASKS.entries()) {
      if (await findWorkItemByTitle(tx, structure.principal.personId, title)) continue;
      await createWorkItem(tx, pctx, {
        typeCode: "task",
        title,
        description: "لطفاً تا مهلت تعیین‌شده در پنل ثبت کنید.",
        priority: i === 0 ? "high" : "normal",
        dueAt: dueAt(i === 0 ? 2 : 9),
        recipients: { kind: "persons", ids: structure.teachers.map((te) => te.personId) },
      });
    }
  });

  lap("staffItemsMs");

  const counts = await withOrg(db, orgId, async (tx) => {
    const count = async (table: string, where = ""): Promise<number> => {
      const res = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table} ${where}`));
      return res.rows[0].n;
    };
    return {
      classGroups: await count("tenancy.class_group"),
      offerings: await count("tenancy.class_offering"),
      staff: await count("iam.staff_profile"),
      students: await count("iam.student_profile"),
      accounts: await count("iam.organization_membership"),
      classEnrollments: await count("academic.class_enrollment", "where status = 'active'"),
      teacherAssignments: await count("academic.teacher_assignment", "where valid_to is null"),
      workItems: await count("workspace.work_item"),
      assignees: await count("workspace.work_item_assignee"),
      comments: await count("workspace.work_item_comment"),
      notifications: await count("notif.notification"),
      createdAccounts: created.created,
      ...phase,
    };
  });

  return { org: spec.name, school: spec.school.name, code: spec.school.code, admin: structure.admin, principal: structure.principal, vice: structure.vice, teachers: structure.teachers, classes, counts };
}

export interface PilotCounts extends Record<string, number> {
  organizations: number;
  schools: number;
  students: number;
  workItems: number;
}

/** Global counts (as app_owner, per pilot organization so FORCE RLS lets us see the rows). */
export async function pilotCounts(db: Db): Promise<PilotCounts> {
  const totals: PilotCounts = { organizations: 0, schools: 0, classGroups: 0, offerings: 0, staff: 0, students: 0, accounts: 0, classEnrollments: 0, teacherAssignments: 0, workItems: 0, comments: 0, notifications: 0 };
  const orgs = await db.select({ id: organization.id }).from(organization).where(inArray(organization.slug, PILOT_ORGS.map((o) => o.slug)));
  totals.organizations = orgs.length;
  for (const { id } of orgs) {
    await withOrg(db, id, async (tx) => {
      const count = async (table: string, where = ""): Promise<number> => {
        const res = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table} ${where}`));
        return res.rows[0].n;
      };
      totals.schools += await count("tenancy.school");
      totals.classGroups += await count("tenancy.class_group");
      totals.offerings += await count("tenancy.class_offering");
      totals.staff += await count("iam.staff_profile");
      totals.students += await count("iam.student_profile");
      totals.accounts += await count("iam.organization_membership");
      totals.classEnrollments += await count("academic.class_enrollment", "where status = 'active'");
      totals.teacherAssignments += await count("academic.teacher_assignment", "where valid_to is null");
      totals.workItems += await count("workspace.work_item");
      totals.comments += await count("workspace.work_item_comment");
      totals.notifications += await count("notif.notification");
    });
  }
  return totals;
}

// ---------------------------------------------------------------------------------------------------------------
// reset (--reset): wipe the three pilot organizations and nothing else
// ---------------------------------------------------------------------------------------------------------------

export interface PilotResetResult {
  /** Pilot organizations found and removed (0–3). */
  organizations: number;
  /** Rows deleted per `schema.table`, tenant tables first, then the global account rows. Zero-count tables omitted. */
  deleted: Record<string, number>;
}

/**
 * Tenant tables of the app schemas (every table with an `organization_id` column), ordered so that a table is
 * deleted before any table it references — Kahn's algorithm over the FK graph, self-references ignored (phase 1
 * never sets `work_item.parent_work_item_id`).
 */
async function tenantTablesInDeleteOrder(db: Db): Promise<string[]> {
  const tables = await db.execute<{ t: string }>(sql`
    select c.table_schema || '.' || c.table_name as t
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.column_name = 'organization_id'
      and c.table_schema in ('tenancy','iam','academic','workspace','notif','files','audit','config','integ')
    order by 1`);
  const names = new Set(tables.rows.map((r) => r.t));
  const edges = await db.execute<{ child: string; parent: string }>(sql`
    select ns.nspname || '.' || cl.relname as child, pns.nspname || '.' || pcl.relname as parent
    from pg_constraint co
    join pg_class cl on cl.oid = co.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
    join pg_class pcl on pcl.oid = co.confrelid join pg_namespace pns on pns.oid = pcl.relnamespace
    where co.contype = 'f'`);
  // parent → children that reference it; a table is deletable once every child is gone.
  const remaining = new Map<string, Set<string>>();
  for (const t of names) remaining.set(t, new Set());
  for (const e of edges.rows) if (e.child !== e.parent && names.has(e.child) && names.has(e.parent)) remaining.get(e.parent)!.add(e.child);
  const order: string[] = [];
  const done = new Set<string>();
  while (done.size < names.size) {
    const ready = [...names].filter((t) => !done.has(t) && [...remaining.get(t)!].every((c) => done.has(c))).sort();
    if (ready.length === 0) throw new Error(`pilot reset: FK cycle among ${[...names].filter((t) => !done.has(t)).join(", ")}`);
    for (const t of ready) {
      order.push(t);
      done.add(t);
    }
  }
  return order;
}

/**
 * Deletes everything of the three pilot organizations: every row with their `organization_id` (children before
 * parents, under the tenant context so FORCE RLS lets app_owner see them), then the organizations themselves, then
 * the global `user_session` / `auth_identity` / `user_account` rows of accounts that no longer hold any membership.
 * Organizations with other slugs (the demo, a real customer) are never touched.
 */
export async function resetPilot(db: Db): Promise<PilotResetResult> {
  const orgs = await db.select({ id: organization.id, slug: organization.slug }).from(organization).where(inArray(organization.slug, PILOT_ORGS.map((o) => o.slug)));
  const deleted: Record<string, number> = {};
  const add = (key: string, n: number) => {
    if (n > 0) deleted[key] = (deleted[key] ?? 0) + n;
  };
  if (orgs.length === 0) return { organizations: 0, deleted };
  const order = await tenantTablesInDeleteOrder(db);
  const accountIds = new Set<string>();
  for (const org of orgs) {
    await withOrg(db, org.id, async (tx) => {
      const members = await tx.execute<{ id: string }>(sql`select user_account_id as id from iam.organization_membership where organization_id = ${org.id}::uuid`);
      for (const m of members.rows) accountIds.add(m.id);
      for (const t of order) {
        const res = await tx.execute(sql`delete from ${sql.raw(t)} where organization_id = ${org.id}::uuid`);
        add(t, res.rowCount ?? 0);
      }
      const res = await tx.execute(sql`delete from tenancy.organization where id = ${org.id}::uuid`);
      add("tenancy.organization", res.rowCount ?? 0);
    });
  }
  if (accountIds.size > 0) {
    const ids = [...accountIds];
    await db.transaction(async (tx) => {
      // Only accounts with no membership left anywhere (pilot phones live in their own blocks, so that is all of them).
      const orphan = sql`id = any(${sql.param(ids, undefined)}::uuid[]) and not exists (select 1 from iam.organization_membership m where m.user_account_id = iam.user_account.id)`;
      const sessions = await tx.execute(sql`delete from iam.user_session where user_account_id in (select id from iam.user_account where ${orphan})`);
      add("iam.user_session", sessions.rowCount ?? 0);
      const identities = await tx.execute(sql`delete from iam.auth_identity where user_account_id in (select id from iam.user_account where ${orphan})`);
      add("iam.auth_identity", identities.rowCount ?? 0);
      const accounts = await tx.execute(sql`delete from iam.user_account where ${orphan}`);
      add("iam.user_account", accounts.rowCount ?? 0);
    });
  }
  return { organizations: orgs.length, deleted };
}

export interface SeedPilotResult {
  summaries: SchoolSummary[];
  password: string;
  scale: number;
  ms: number;
}

export async function seedPilot(db: Db, opts: { password?: string; scale?: number } = {}): Promise<SeedPilotResult> {
  const started = Date.now();
  const password = opts.password ?? process.env.PILOT_PASSWORD ?? PILOT_DEFAULT_PASSWORD;
  if (password.length < 8) throw new Error("PILOT_PASSWORD must be at least 8 characters");
  const scale = opts.scale ?? Number(process.env.PILOT_SCALE ?? "1");
  if (!(scale > 0 && scale <= 1)) throw new Error("PILOT_SCALE must be in (0, 1]");
  const roles = await db.select({ code: role.code, id: role.id }).from(role).where(and(isNull(role.organizationId), eq(role.code, "org_admin")));
  if (!roles[0]) throw new Error("system roles missing — run `pnpm seed` (catalog) first");
  const secretHash = await hashPassword(password);
  const summaries: SchoolSummary[] = [];
  for (const spec of PILOT_ORGS) summaries.push(await seedPilotOrg(db, spec, { password, scale, roleIds: { org_admin: roles[0].id } }, secretHash));
  return { summaries, password, scale, ms: Date.now() - started };
}

// ---------------------------------------------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------------------------------------------

/** `+98935…` → `0935…` (what testers type). */
const national = (e164: string) => `0${e164.slice(3)}`;
const loginId = (id: string) => (id.startsWith("+98") ? national(id) : id);

export function renderAccountsMarkdown(result: SeedPilotResult): string {
  const lines: string[] = [];
  lines.push("# حساب‌های پایلوت", "", `رمز همهٴ حساب‌ها: \`${result.password}\` (بدون تغییر رمز اجباری). ورود با موبایل یا نام‌کاربری.`, "");
  for (const s of result.summaries) {
    lines.push(`## ${s.org} — ${s.school} (\`${s.code}\`)`, "");
    lines.push("| نقش | نام | ورود |", "|---|---|---|");
    lines.push(`| مدیر سازمان | ${s.admin.name} | \`${national(s.admin.phone)}\` |`);
    lines.push(`| مدیر مدرسه | ${s.principal.name} | \`${national(s.principal.phone)}\` |`);
    lines.push(`| معاون | ${s.vice.name} | \`${national(s.vice.phone)}\` |`, "");
    lines.push("### دبیران", "", "| نام | ورود | درس‌ها |", "|---|---|---|");
    for (const t of s.teachers) lines.push(`| ${t.name} | \`${national(t.phone)}\` | ${t.offerings.join("، ")} |`);
    lines.push("", "### دانش‌آموزان (سه نفر اول هر کلاس)", "", "| کلاس | نام | ورود |", "|---|---|---|");
    for (const c of s.classes) for (const st of c.students) lines.push(`| ${c.name} | ${st.name} | \`${loginId(st.loginIdentifier)}\` |`);
    lines.push("");
    lines.push(
      `شمارش: ${s.counts.classGroups} کلاس، ${s.counts.offerings} ارائهٴ درس، ${s.counts.staff} همکار، ${s.counts.students} دانش‌آموز، ${s.counts.accounts} حساب، ${s.counts.teacherAssignments} تخصیص دبیر، ${s.counts.workItems} کار، ${s.counts.comments} نظر، ${s.counts.notifications} اعلان.`,
      "",
    );
  }
  return lines.join("\n");
}

function printSummary(result: SeedPilotResult): void {
  for (const s of result.summaries) {
    console.log(`\n[seed:pilot] ${s.org} / ${s.school} (${s.code}) — ${s.counts.createdAccounts} accounts created this run`);
    console.log(
      `  ${s.counts.classGroups} classes, ${s.counts.offerings} offerings, ${s.counts.staff} staff, ${s.counts.students} students, ${s.counts.accounts} accounts, ${s.counts.classEnrollments} enrollments, ${s.counts.teacherAssignments} teacher assignments, ${s.counts.workItems} work items, ${s.counts.assignees} assignees, ${s.counts.comments} comments, ${s.counts.notifications} notifications`,
    );
    console.log(`  phases: structure+staff ${(s.counts.structureMs / 1000).toFixed(1)} s · students ${(s.counts.studentsMs / 1000).toFixed(1)} s · teacher tasks + student reactions ${(s.counts.teacherItemsMs / 1000).toFixed(1)} s · staff items ${(s.counts.staffItemsMs / 1000).toFixed(1)} s`);
    console.log(`  admin ${s.admin.name} ${national(s.admin.phone)} · principal ${s.principal.name} ${national(s.principal.phone)} · vice ${s.vice.name} ${national(s.vice.phone)}`);
    for (const t of s.teachers) console.log(`  teacher ${t.name.padEnd(22)} ${national(t.phone)}  ${t.offerings.join("، ")}`);
    for (const c of s.classes) console.log(`  class ${c.name}: ${c.students.map((st) => `${st.name} (${loginId(st.loginIdentifier)})`).join(" · ")}`);
  }
  console.log(`\n[seed:pilot] password for every pilot account: ${result.password}  (scale ${result.scale}, ${(result.ms / 1000).toFixed(1)} s)`);
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

async function main(): Promise<void> {
  loadDotEnv();
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW !== "1") {
    console.error("[seed:pilot] refusing to run with NODE_ENV=production without SEED_ALLOW=1");
    process.exit(3);
  }
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is not set (see .env.example)");
  const reset = process.argv.includes("--reset");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const db = drizzle({ client: pool, schema });
    if (reset) {
      const r = await resetPilot(db);
      console.log(`[seed:pilot] --reset: removed ${r.organizations} pilot organization(s)`);
      for (const [t, n] of Object.entries(r.deleted)) console.log(`  ${t.padEnd(36)} ${n}`);
    }
    await seedCatalog(db);
    const result = await seedPilot(db);
    printSummary(result);
    const dir = path.resolve(process.cwd(), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, "pilot-accounts.md");
    fs.writeFileSync(out, renderAccountsMarkdown(result), "utf8");
    console.log(`[seed:pilot] accounts sheet → ${out}`);
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error("[seed:pilot] FAILED:", err instanceof Error ? err.stack ?? err.message : err);
      process.exit(1);
    });
}
