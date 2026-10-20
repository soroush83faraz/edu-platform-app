// Pilot dataset: THREE separate organizations (tenants), each one real-feeling school with a full year of structure,
// ~40 staff and ~550 students in total, and a living کارتابل (tasks by every teacher, student comments and «انجام شد»,
// staff todos, admin tasks) — so the product can be exercised with many users and cross-tenant isolation. «فرزانگان»
// and the دبستان also get a «مشاور» (owner, 2026-10-13) with sample notes, a teacher's report and an open referral.
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
// with a direct UPDATE (one precomputed argon2 hash instead of ~600 extra hashes). «اولیا» (2026-10-18): a few
// guardians per school through the guardian service — one with TWO children (siblings in two classes) and a teacher
// who is also a parent (the «ولی» role joins the teacher's own account) — before the کارتابل and the roll calls, so
// their bell holds real «غیبت» (and, in the دبستان, «کارنامه») notifications. «ارتباط ولی و مدرسه» (2026-10-19): the
// first guardian's two sample «پیام به مدرسه» — a question to a teacher, answered, and an open suggestion to the principal.
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
import { drizzle, type NodePgClient, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { findAttendanceSession, listClassRoster, listClassSlots } from "../src/modules/academic/repo";
import { takeAttendance } from "../src/modules/academic/attendance";
import { canonicalSubject } from "../src/modules/academic/primary-objectives";
import { saveObjectiveRatings } from "../src/modules/academic/report-card";
import { tehranToday } from "../src/lib/attendance";
import { assignTeacher, setTimetableSlot } from "../src/modules/academic/service";
import { weekdayOfIso } from "../src/lib/attendance";
import { DEFAULT_PERIODS, SCHOOL_WEEKDAYS } from "../src/lib/timetable";
import type { Assignment } from "../src/modules/iam/can";
import { hashPassword } from "../src/modules/iam/password";
import { IMPLICIT_PERMISSIONS, PERMISSIONS } from "../src/modules/iam/permissions";
import { listValidAssignments } from "../src/modules/iam/repo";
import { addGuardian } from "../src/modules/iam/guardian";
import { childMessagesPage, sendGuardianMessage } from "../src/modules/iam/guardian-messages";
import type { MessageDestination, MessageKind } from "../src/modules/iam/guardian-message-policy";
import { createStaff, createStudent, findAccountOfPerson, setPersonPhones, type IamCtx } from "../src/modules/iam/service";
import { findAcademicYearByName, findClassGroupByName, findDefaultBranch, findGradeLevelByCode, findOffering, findSchoolByCode, findSubjectByCode } from "../src/modules/tenancy/repo";
import { createAcademicYear, createClassGroup, createClassOffering, createSchool, createSubject, ensureCatalogYears, updateBranch, upsertTerm } from "../src/modules/tenancy/service";
import { addComment, changeStatus, createWorkItem, type WorkspaceCtx } from "../src/modules/workspace/service";
import type { NoteKind, NoteVisibility } from "../src/modules/counseling/policy";
import { createCounselorNote, createTeacherReport, referToManagement } from "../src/modules/counseling/service";
import { ensureOrgCatalog, ensureOrgObjectives, seedCatalog } from "./seed";
import { attendanceStatusFor, minutesLateFor, pastSchoolDays, rollCallPeriod } from "./attendance-plan";
import { hasTeacherClash, planTimetables, type PlanClass } from "./timetable-plan";

/** A drizzle database with its driver (`$client`), which the organization catalog seed writes through. */
export type Db = NodePgDatabase<typeof schema> & { $client: NodePgClient };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const {
  organization,
  person,
  staffProfile,
  studentProfile,
  role,
  authIdentity,
  userAccount,
  organizationMembership,
  contactPoint,
  teacherAssignment,
  workItem,
  workItemAssignee,
  workItemComment,
  counselorNote,
  teacherReport,
  referral,
  guardianLink,
  guardianMessage,
} = schema;

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
  /**
   * Only these classes (by name) — a دبستان's آموزگار teaches every درس of ONE class (`DABESTAN`); omitted = any
   * class of the school.
   */
  classes?: string[];
}

export interface PilotOrgSpec {
  key: string;
  name: string;
  slug: string;
  /** Phone block digit pair after +98935. */
  phoneBlock: number;
  school: { code: string; name: string; gender: "girls" | "boys"; branchName: string };
  subjects: PilotSubject[];
  classes: PilotClass[];
  teachers: PilotTeacherSpec[];
  adminGender: Gender;
  /** Students per class at scale 1 (default 25). */
  classSize?: number;
  /** A دبستان: its آموزگاران also get sample «کارنامهٴ توصیفی» ratings for مهر (`seedReportCards`). */
  primary?: boolean;
  /** A «مشاور» with sample notes, one teacher's report and one open referral (`seedCounseling`, owner 2026-10-13). */
  counseling?: boolean;
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
  counseling: true,
};

export const HELLI: PilotOrgSpec = {
  key: "hl4",
  name: "حلی",
  slug: "helli",
  phoneBlock: 30,
  school: { code: "HL4", name: "حلی ۴", gender: "boys", branchName: "مرکزی" },
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

const PRIMARY_PILOT_SUBJECTS: PilotSubject[] = [
  { code: "QURAN", name: "قرآن" },
  { code: "HED", name: "هدیه‌های آسمان" },
  { code: "FA", name: "فارسی" },
  { code: "MATH", name: "ریاضی" },
  { code: "SCI", name: "علوم تجربی" },
  { code: "SOC", name: "مطالعات اجتماعی" },
  { code: "TAF", name: "تفکر و پژوهش" },
  { code: "TECH", name: "کار و فناوری" },
  { code: "ART", name: "هنر" },
  { code: "PE", name: "تربیت بدنی" },
];

/** The درس‌ها of each primary پایه (as the school's objective documents have them; ورزش everywhere). */
const PRIMARY_CLASSES: PilotClass[] = [
  { name: "اول الف", grade: "G1", subjects: ["QURAN", "FA", "MATH", "SCI", "ART", "PE"] },
  { name: "دوم الف", grade: "G2", subjects: ["QURAN", "HED", "FA", "MATH", "SCI", "ART", "PE"] },
  { name: "سوم الف", grade: "G3", subjects: ["QURAN", "HED", "FA", "MATH", "SCI", "SOC", "ART", "PE"] },
  { name: "چهارم الف", grade: "G4", subjects: ["QURAN", "HED", "FA", "MATH", "SCI", "SOC", "ART", "PE"] },
  { name: "پنجم الف", grade: "G5", subjects: ["QURAN", "HED", "FA", "MATH", "SCI", "SOC", "ART", "PE"] },
  { name: "ششم الف", grade: "G6", subjects: ["QURAN", "HED", "FA", "MATH", "SCI", "SOC", "TAF", "TECH", "ART", "PE"] },
];

/**
 * «کارنامهٴ توصیفی» demo (owner, 2026-10-13): a small primary school in its OWN pilot organisation — the pilot
 * specs are one school per organisation, and a fourth tenant keeps the three secondary pilots (and the demo extras
 * built on them) exactly as they were. Grades ۱–۶, one class each, ~10 students, one آموزگار per class who teaches
 * every درس of it (the classic دبستان) and one ورزش teacher for all six (a درس with its own teacher), principal +
 * vice, the shared pilot password — and sample ratings for مهر so the report card is not empty.
 */
export const DABESTAN: PilotOrgSpec = {
  key: "dbs",
  name: "دبستان پیشگامان",
  slug: "pishgaman",
  phoneBlock: 40,
  school: { code: "DBS", name: "دبستان پیشگامان", gender: "girls", branchName: "مرکزی" },
  subjects: PRIMARY_PILOT_SUBJECTS,
  classes: PRIMARY_CLASSES,
  teachers: [
    ...PRIMARY_CLASSES.map((c) => ({ subjects: c.subjects.filter((code) => code !== "PE"), classes: [c.name] })),
    { subjects: ["PE"] },
  ],
  adminGender: "female",
  classSize: 10,
  primary: true,
  counseling: true,
};

/** Every organisation `pnpm seed:pilot` writes (and `--reset` removes): the three secondary pilots + the دبستان. */
export const SEEDED_PILOT_ORGS: PilotOrgSpec[] = [...PILOT_ORGS, DABESTAN];

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
      const capable = spec.teachers.flatMap((t, i) => (t.subjects.includes(code) && (!t.classes || t.classes.includes(cls.name)) ? [i] : []));
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

/** Sessions per week of one offering: 2, 3 or 4 — deterministic from the key (`weekly_hours` stays 3 on the row). */
export function sessionsOf(orgKey: string, offeringKey: string): number {
  return 2 + hashInt(`sessions:${orgKey}:${offeringKey}`, 3);
}

/**
 * The weekly timetable of every class of a school over the six default زنگ‌ها: each offering `sessionsOf` cells,
 * no teacher in two classes at once (`planTimetables`, teacher = the allocation index). Throws when the plan cannot
 * place every session — the rosters above always fit (asserted by tests/int/seed-pilot.test.ts).
 */
export function planPilotTimetable(spec: PilotOrgSpec, allocation: string[][]) {
  const teacherOf = new Map<string, number>();
  allocation.forEach((keys, t) => keys.forEach((k) => teacherOf.set(k, t)));
  const classes: PlanClass[] = spec.classes.map((c) => ({
    key: c.name,
    offerings: c.subjects.map((code) => {
      const key = `${c.name}:${code}`;
      return { key, teacherKey: String(teacherOf.get(key)), sessions: sessionsOf(spec.key, key) };
    }),
  }));
  const plan = planTimetables(classes, SCHOOL_WEEKDAYS, DEFAULT_PERIODS.map((p) => p.periodNo));
  if (plan.unplaced.length > 0) throw new Error(`pilot ${spec.key}: ${plan.unplaced.length} timetable sessions could not be placed`);
  if (hasTeacherClash(plan, classes)) throw new Error(`pilot ${spec.key}: timetable plan double-books a teacher`);
  return plan;
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

export function studentsPerClass(scale: number, spec?: Pick<PilotOrgSpec, "classSize">): number {
  return Math.max(2, Math.round((spec?.classSize ?? 25) * scale));
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
  /** One «مشاور» per organization with `counseling`. */
  counselors: number;
  students: number;
  workItems: number;
  /** Timetable cells over all classes: Σ `sessionsOf` per offering. */
  timetableSlots: number;
}

export function expectedCounts(scale: number): ExpectedCounts {
  let classGroups = 0;
  let offerings = 0;
  let teachers = 0;
  let counselors = 0;
  let students = 0;
  let workItems = 0;
  let timetableSlots = 0;
  for (const spec of SEEDED_PILOT_ORGS) {
    classGroups += spec.classes.length;
    offerings += spec.classes.reduce((n, c) => n + c.subjects.length, 0);
    teachers += spec.teachers.length;
    students += spec.classes.length * studentsPerClass(scale, spec);
    workItems += spec.teachers.reduce((n, _t, i) => n + tasksOfTeacher(i, scale), 0) + 2 * STAFF_TODOS.length + ADMIN_TASKS.length;
    // The counselor's one open «ارجاع به مدیریت» is a work item too.
    if (spec.counseling) {
      counselors += 1;
      workItems += 1;
    }
    // «ارتباط ولی و مدرسه»: the first guardian's sample messages (a school with guardians — `seedGuardians`).
    if (spec.classes.length >= 2 && spec.teachers.length > 0) workItems += SAMPLE_GUARDIAN_MESSAGES.length;
    timetableSlots += spec.classes.reduce((n, c) => n + c.subjects.reduce((m, code) => m + sessionsOf(spec.key, `${c.name}:${code}`), 0), 0);
  }
  return { organizations: SEEDED_PILOT_ORGS.length, schools: SEEDED_PILOT_ORGS.length, classGroups, offerings, teachers, counselors, students, workItems, timetableSlots };
}

// ---------------------------------------------------------------------------------------------------------------
// seeding
// ---------------------------------------------------------------------------------------------------------------

const ALL_ROLE_PERMS = PERMISSIONS.map((p) => p.code).filter((c) => !IMPLICIT_PERMISSIONS.includes(c));

export interface ActorCtx extends IamCtx, WorkspaceCtx {
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

/** A pilot guardian as the accounts sheet lists it. */
export interface GuardianOut {
  name: string;
  /** «لیلا نیک‌خواه (اول الف)» per child. */
  children: string[];
  loginIdentifier: string;
  /** A teacher who is also a parent: they sign in with their own staff account. */
  teacher: boolean;
}

export interface SchoolSummary {
  org: string;
  school: string;
  code: string;
  admin: StaffOut;
  principal: StaffOut;
  vice: StaffOut;
  /** «اولیا»: the school's sample guardians (`seedGuardians`). */
  guardians: GuardianOut[];
  /** The school's «مشاور», when the spec has `counseling`. */
  counselor: StaffOut | null;
  teachers: TeacherOut[];
  classes: Array<{ name: string; students: StudentOut[] }>;
  counts: Record<string, number>;
  /** A دبستان (its accounts sheet explains «کارنامهٴ توصیفی»). */
  primary: boolean;
}

export async function withOrg<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/**
 * The real assignments of a person, as a full service ctx (`listValidAssignments`, like scripts/import.ts). `source`
 * names the script in the audit rows (`request_id`, `user_agent`).
 */
export async function actorCtx(
  tx: Tx,
  orgId: string,
  personId: string,
  cache: Map<string, ActorCtx>,
  source: { requestId: string; userAgent: string } = { requestId: "seed-pilot", userAgent: "scripts/seed-pilot.ts" },
): Promise<ActorCtx> {
  const hit = cache.get(personId);
  if (hit) return hit;
  const account = await findAccountOfPerson(tx, personId);
  const assignments = await listValidAssignments(tx, personId);
  if (assignments.length === 0) throw new Error(`pilot: person ${personId} has no valid role assignment`);
  const ctx: ActorCtx = { orgId, personId, userId: account?.userAccountId ?? null, ...source, assignments };
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
  roles: Array<{ roleCode: "org_admin" | "school_principal" | "vice_principal" | "counselor"; schoolId?: string | null }>;
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
  const perClass = studentsPerClass(opts.scale, spec);
  const created = { created: 0 };
  const phase: Record<string, number> = {};
  let mark = Date.now();
  const lap = (name: string) => {
    phase[name] = Date.now() - mark;
    mark = Date.now();
  };

  // Global row: no RLS.
  await db.insert(organization).values({ id: orgId, name: spec.name, slug: spec.slug, status: "active" }).onConflictDoNothing({ target: organization.slug });
  // A new organization starts with the fixed مقطع‌ها + پایه‌ها (src/modules/tenancy/fixed-catalog.ts).
  await ensureOrgCatalog(db, orgId);

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

    // مقطع‌ها and پایه‌ها are the FIXED catalog (`ensureOrgCatalog` right after the organization row): look them up.
    const gradeIds: Record<string, string> = {};
    for (const code of new Set(spec.classes.map((c) => c.grade))) {
      const existing = await findGradeLevelByCode(tx, code);
      if (!existing) throw new Error(`pilot: grade ${code} is not in the fixed catalog`);
      gradeIds[code] = existing.id;
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
    // …and the rest of the fixed years (۱۴۰۶-۱۴۰۷), as every school gets them.
    await ensureCatalogYears(tx, ctx, schoolId);

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
    // «مشاور» (owner, 2026-10-13): granted by the organization admin like a vice principal, at the school.
    const counselor = spec.counseling
      ? await ensureStaff(
          tx,
          ctx,
          spec,
          { key: "counselor", gender: staffGender, phone: pilotPhone(spec.phoneBlock, 4), schoolId, roles: [{ roleCode: "counselor", schoolId }] },
          pilotName(staffGender, k("counselor"), 0),
          secretHash,
          created,
        )
      : null;
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

    // ---- weekly timetable: every class over the six default زنگ‌ها, through the service as the org admin ----
    // (the permission catalog must already carry `academic.timetable.write` — seedCatalog runs first).
    const plan = planPilotTimetable(spec, allocation);
    for (const c of spec.classes) {
      const classGroupId = classIds[c.name];
      const existing = await listClassSlots(tx, classGroupId);
      const planned = plan.slots.get(c.name) ?? [];
      for (const slot of planned) {
        const classOfferingId = offeringIds[slot.offeringKey];
        const current = existing.find((e) => e.weekday === slot.weekday && e.periodNo === slot.periodNo);
        if (current?.offeringId === classOfferingId) continue;
        await setTimetableSlot(tx, ctx, { classGroupId, weekday: slot.weekday, periodNo: slot.periodNo, classOfferingId });
      }
      // Cells the plan no longer uses (a re-planned seed) are cleared, so the grid always equals the plan.
      for (const e of existing) {
        if (!planned.some((p) => p.weekday === e.weekday && p.periodNo === e.periodNo)) {
          await setTimetableSlot(tx, ctx, { classGroupId, weekday: e.weekday, periodNo: e.periodNo, classOfferingId: null });
        }
      }
    }
    return { admin, principal, vice, counselor, teachers, classIds, offeringIds, subjectNames, allocation };
  });

  // The primary learning objectives («کارنامهٴ توصیفی»), now that the درس rows exist to link (every pilot org gets
  // them, as the deploy's catalog step would; only the دبستان uses them).
  await ensureOrgObjectives(db, orgId);
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

  // ---- 2b. «اولیا»: a few guardians, one of two siblings, one a teacher (owner, 2026-10-18) ----
  const guardians = await seedGuardians(db, orgId, spec, perClass, structure, ctxCache, secretHash, created);
  lap("guardiansMs");

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
        // Tasks seeded before migration 0015 carry no درس: link them so the subject pages of the pilot are not empty.
        if (workItemId) await tx.update(workItem).set({ classOfferingId: structure.offeringIds[key] }).where(and(eq(workItem.id, workItemId), isNull(workItem.classOfferingId)));
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

  // ---- 5. حضور و غیاب: the last three weeks of roll calls, one per class per school day ----
  // The FIRST زنگ of each class's day carries the roll call (where a homeroom teacher takes it) and the teacher of
  // that درس is the one who takes it — through the service, with their own ctx, so the scope rule and the audit
  // trail are the real ones. Idempotent: a day that already has a session is skipped, so a second run writes
  // nothing (tests/int/seed-pilot.test.ts compares the counts of two runs).
  await seedAttendance(db, orgId, spec, structure, ctxCache, ATTENDANCE_DAYS);
  lap("attendanceMs");

  // ---- 6. «کارنامهٴ توصیفی»: sample ratings for مهر in the دبستان, by each class's own آموزگار ----
  if (spec.primary) await seedReportCards(db, orgId, spec, structure, ctxCache);

  // ---- 7. «مشاوره»: the counselor's sample notes, one teacher's report and one open referral ----
  if (structure.counselor) await seedCounseling(db, orgId, spec, { ...structure, counselor: structure.counselor }, opts.scale, ctxCache);

  // ---- 8. «ارتباط ولی و مدرسه»: the first guardian's sample messages, one answered (owner, 2026-10-19) ----
  if (guardians.length > 0) await seedGuardianMessages(db, orgId, spec, ctxCache);

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
      timetableSlots: await count("academic.timetable_slot"),
      attendanceSessions: await count("academic.attendance_session"),
      attendanceEntries: await count("academic.attendance_entry"),
      objectiveRatings: await count("academic.objective_rating"),
      counselorNotes: await count("counseling.counselor_note"),
      teacherReports: await count("counseling.teacher_report"),
      referrals: await count("counseling.referral"),
      guardianLinks: await count("iam.guardian_link", "where status = 'active'"),
      guardianMessages: await count("workspace.guardian_message"),
      workItems: await count("workspace.work_item"),
      assignees: await count("workspace.work_item_assignee"),
      comments: await count("workspace.work_item_comment"),
      notifications: await count("notif.notification"),
      createdAccounts: created.created,
      ...phase,
    };
  });

  return {
    primary: spec.primary === true,
    org: spec.name,
    school: spec.school.name,
    code: spec.school.code,
    admin: structure.admin,
    principal: structure.principal,
    vice: structure.vice,
    counselor: structure.counselor,
    teachers: structure.teachers,
    classes,
    guardians,
    counts,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// «اولیا» (owner, 2026-10-18)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Which students of a pilot school get a guardian, and whose phone that guardian signs in with: the first two (three
 * at full scale) students of the FIRST class with their own «ولی» phone (a mother, then fathers); the first student of
 * the SECOND class shares the first one's mother (siblings — one guardian, one account, two children); the second
 * student of the second class has the school's first TEACHER as a parent (the «ولی» role joins the teacher's account).
 * `cls`/`j` index the spec's classes and the class's students; every class holds `perClass` students.
 */
export function guardianPlan(perClass: number): Array<{ cls: number; j: number; relation: "father" | "mother"; phoneOf: "self" | "sibling" | "teacher" }> {
  return [
    { cls: 0, j: 0, relation: "mother", phoneOf: "self" },
    { cls: 1, j: 0, relation: "mother", phoneOf: "sibling" },
    { cls: 0, j: 1, relation: "father", phoneOf: "self" },
    ...(perClass >= 3 ? [{ cls: 0, j: 2, relation: "father" as const, phoneOf: "self" as const }] : []),
    { cls: 1, j: 1, relation: "father", phoneOf: "teacher" },
  ];
}

/**
 * The sample guardians, through `addGuardian` with the organization admin's REAL ctx (the audit trail, the derived
 * roles and the phone rules are the product's own): each new guardian account gets the shared pilot password; a
 * sibling's and the teacher's child get that guardian's phone as their «ولی» contact point, so «ساخت حساب اولیا» on
 * their class later finds them already linked. Idempotent: a second run links and creates nothing.
 */
async function seedGuardians(
  db: Db,
  orgId: string,
  spec: PilotOrgSpec,
  perClass: number,
  structure: { admin: StaffOut; teachers: TeacherOut[] },
  ctxCache: Map<string, ActorCtx>,
  secretHash: string,
  created: { created: number },
): Promise<GuardianOut[]> {
  if (spec.classes.length < 2 || structure.teachers.length === 0) return [];
  return withOrg(db, orgId, async (tx) => {
    const ctx = await actorCtx(tx, orgId, structure.admin.personId, ctxCache);
    const studentAt = async (cls: number, j: number) => {
      const studentNumber = String(14051001 + cls * perClass + j);
      const [row] = await tx
        .select({ personId: person.id, firstName: person.firstName, lastName: person.lastName, studentProfileId: studentProfile.id })
        .from(person)
        .innerJoin(studentProfile, eq(studentProfile.personId, person.id))
        .where(eq(person.externalRef, `pilot:${spec.key}:student:${studentNumber}`))
        .limit(1);
      if (!row) throw new Error(`pilot: guardians — student ${studentNumber} of ${spec.key} not found`);
      const [phone] = await tx
        .select({ value: contactPoint.value })
        .from(contactPoint)
        .where(and(eq(contactPoint.personId, row.personId), eq(contactPoint.kind, "mobile"), eq(contactPoint.label, "ولی")))
        .limit(1);
      return { ...row, className: spec.classes[cls].name, guardianPhone: phone?.value ?? null };
    };
    const out = new Map<string, GuardianOut>();
    let sibling: { phone: string; firstName: string; lastName: string } | null = null;
    for (const [i, g] of guardianPlan(perClass).entries()) {
      const child = await studentAt(g.cls, g.j);
      const teacher = structure.teachers[0];
      const gender = g.relation === "mother" ? "female" : "male";
      let phone: string;
      let names: { firstName: string; lastName: string };
      if (g.phoneOf === "teacher") {
        phone = teacher.phone;
        const [first, ...rest] = teacher.name.split(" ");
        names = { firstName: first, lastName: rest.join(" ") };
      } else if (g.phoneOf === "sibling" && sibling) {
        phone = sibling.phone;
        names = { firstName: sibling.firstName, lastName: sibling.lastName };
      } else {
        if (!child.guardianPhone) throw new Error(`pilot: guardians — student ${child.personId} has no «ولی» phone`);
        phone = child.guardianPhone;
        names = { firstName: pilotName(gender, `${spec.key}:guardians`, i).firstName, lastName: child.lastName };
        if (i === 0) sibling = { phone, ...names };
      }
      // The child's «ولی» contact point names the guardian who signs in for them (a sibling's / the teacher's phone).
      if (child.guardianPhone !== phone) await setPersonPhones(tx, ctx, child.personId, { guardianPhone: phone });
      // The teacher follows the school's staff: a girls' school's teachers are women — the child's mother.
      const relation = g.phoneOf === "teacher" && spec.school.gender === "girls" ? "mother" : g.relation;
      const res = await addGuardian(tx, ctx, { studentProfileId: child.studentProfileId, ...names, phone, relation });
      if (res.account) {
        const [acct] = await tx.select({ id: userAccount.id }).from(userAccount).where(eq(userAccount.loginIdentifier, res.account.loginIdentifier)).limit(1);
        if (acct) await applyPilotPassword(tx, acct.id, secretHash);
        created.created++;
      }
      const [login] = await tx
        .select({ id: userAccount.loginIdentifier })
        .from(organizationMembership)
        .innerJoin(userAccount, eq(userAccount.id, organizationMembership.userAccountId))
        .where(eq(organizationMembership.personId, res.guardianPersonId))
        .limit(1);
      const entry = out.get(res.guardianPersonId) ?? { name: `${names.firstName} ${names.lastName}`, children: [], loginIdentifier: login?.id ?? "—", teacher: g.phoneOf === "teacher" };
      entry.children.push(`${child.firstName} ${child.lastName} (${child.className})`);
      out.set(res.guardianPersonId, entry);
    }
    return [...out.values()];
  });
}

// ---------------------------------------------------------------------------------------------------------------
// حضور و غیاب (the last three weeks)
// ---------------------------------------------------------------------------------------------------------------

/** School days of history the pilot writes; the demo seed uses a shorter window. */
export const ATTENDANCE_DAYS = 21;

interface AttendanceStructure {
  classIds: Record<string, string>;
  offeringIds: Record<string, string>;
  teachers: TeacherOut[];
  allocation: string[][];
  principal: StaffOut;
}

/**
 * One roll call per class per past school day: the class's FIRST زنگ that weekday, taken by the teacher of that
 * درس (the principal stands in when the درس has no teacher), ~۹۲٪ present with a few absent / late / excused —
 * `scripts/attendance-plan.ts` decides every mark from a hash, so the dataset is identical on every machine.
 * One transaction per class; a day whose session already exists is skipped (idempotent).
 */
async function seedAttendance(db: Db, orgId: string, spec: PilotOrgSpec, structure: AttendanceStructure, ctxCache: Map<string, ActorCtx>, days: number): Promise<void> {
  const teacherOfOffering = new Map<string, string>();
  structure.allocation.forEach((keys, t) => {
    for (const key of keys) teacherOfOffering.set(structure.offeringIds[key], structure.teachers[t].personId);
  });
  const schoolDays = pastSchoolDays(days);

  for (const c of spec.classes) {
    const classGroupId = structure.classIds[c.name];
    await withOrg(db, orgId, async (tx) => {
      const slots = await listClassSlots(tx, classGroupId);
      if (slots.length === 0) return;
      for (const date of schoolDays) {
        const weekday = weekdayOfIso(date);
        if (weekday === null) continue;
        const periodNo = rollCallPeriod(slots, weekday);
        if (periodNo === null) continue;
        if (await findAttendanceSession(tx, classGroupId, date, periodNo)) continue;
        const slot = slots.find((s) => s.weekday === weekday && s.periodNo === periodNo);
        const takerPersonId = (slot && teacherOfOffering.get(slot.offeringId)) ?? structure.principal.personId;
        const roster = await listClassRoster(tx, classGroupId, date);
        if (roster.length === 0) continue;
        const ctx = await actorCtx(tx, orgId, takerPersonId, ctxCache);
        await takeAttendance(tx, ctx, {
          classGroupId,
          date,
          periodNo,
          entries: roster.map((r) => {
            // Keyed by the PERSON id (deterministic `pilotId`) — the student_profile id is random per fresh seed, which
            // made WHO was absent differ between two fresh seeds; harmless until «اولیا», whose «غیبت» bell follows it.
            const key = `${spec.key}:${r.personId}:${date}:${periodNo}`;
            const status = attendanceStatusFor(key);
            return { studentProfileId: r.studentProfileId, status, minutesLate: status === "late" ? minutesLateFor(key) : null };
          }),
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// «کارنامهٴ توصیفی» (sample ratings for مهر in the دبستان)
// ---------------------------------------------------------------------------------------------------------------

/** The month the sample report cards are for: مهر, the first month of the school year. */
export const SAMPLE_REPORT_MONTH = 7;

/**
 * A deterministic level for (student, درس, objective position): ~۴۵٪ خیلی خوب, ~۳۳٪ خوب, ~۱۶٪ قابل قبول, ~۶٪ نیاز به
 * تلاش — and ~۱۵٪ of the (student, درس) sheets left unrated, so the class page shows real progress («۸ از ۱۰»).
 */
export function sampleRatingFor(key: string): "very_good" | "good" | "acceptable" | "needs_effort" {
  const n = hashInt(`rating:${key}`, 100);
  return n < 45 ? "very_good" : n < 78 ? "good" : n < 94 ? "acceptable" : "needs_effort";
}
export const sampleSheetSkipped = (key: string): boolean => hashInt(`skip:${key}`, 100) < 15;

/**
 * Every class of a primary pilot school is rated on every درس of مهر through the real service, each درس by the one
 * who may write it (`maySubjectWrite`, owner 2026-10-14) with their own ctx (scope rule + audit): the teacher of that
 * درس in the class — the آموزگار (the teacher of its فارسی) for most, the ورزش teacher for «تربیت بدنی» — and the
 * آموزگار for a درس no offering of the class carries («شایستگی‌های عمومی»). Idempotent by the service itself: a pair
 * that already has the same level is not written, and a save that changes nothing writes no audit row.
 */
async function seedReportCards(db: Db, orgId: string, spec: PilotOrgSpec, structure: { classIds: Record<string, string>; teachers: TeacherOut[]; allocation: string[][] }, ctxCache: Map<string, ActorCtx>): Promise<void> {
  for (const c of spec.classes) {
    const classGroupId = structure.classIds[c.name];
    const teacherOf = (code: string) => structure.allocation.findIndex((keys) => keys.includes(`${c.name}:${code}`));
    const homeroom = teacherOf("FA");
    if (homeroom === -1) continue;
    // The canonical درس of each of the class's pilot درس‌ها → its code (an offering of the class).
    const codeOf = new Map(spec.subjects.filter((s) => c.subjects.includes(s.code)).map((s) => [canonicalSubject(s.name), s.code] as const));
    await withOrg(db, orgId, async (tx) => {
      const objectives = await tx.execute<{ id: string; subject_name: string; sort_order: number }>(sql`
        select lo.id, lo.subject_name, lo.sort_order
        from academic.learning_objective lo
        join tenancy.class_group cg on cg.grade_level_id = lo.grade_level_id
        where cg.id = ${classGroupId}::uuid and lo.month = ${SAMPLE_REPORT_MONTH} and lo.status = 'active'
        order by lo.subject_name, lo.sort_order`);
      const roster = await listClassRoster(tx, classGroupId, tehranToday());
      const subjects = [...new Set(objectives.rows.map((o) => o.subject_name))];
      for (const subjectName of subjects) {
        const code = codeOf.get(subjectName);
        const t = code === undefined ? homeroom : teacherOf(code);
        if (t === -1) continue;
        const ctx = await actorCtx(tx, orgId, structure.teachers[t].personId, ctxCache);
        const entries = roster.flatMap((r) =>
          sampleSheetSkipped(`${spec.key}:${r.personId}:${subjectName}`)
            ? []
            : objectives.rows
                .filter((o) => o.subject_name === subjectName)
                .map((o) => ({ studentProfileId: r.studentProfileId, learningObjectiveId: o.id, rating: sampleRatingFor(`${spec.key}:${r.personId}:${subjectName}:${o.sort_order}`) })),
        );
        if (entries.length > 0) await saveObjectiveRatings(tx, ctx, { classGroupId, month: SAMPLE_REPORT_MONTH, subjectName, entries });
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// «مشاوره» (owner, 2026-10-13): a counselor's sample file
// ---------------------------------------------------------------------------------------------------------------

/** The counselor's sample notes, per picked student (`counselingPicks`, in order). */
export const SAMPLE_NOTES: ReadonlyArray<ReadonlyArray<{ kind: NoteKind; visibility: NoteVisibility; body: string }>> = [
  [
    { kind: "academic", visibility: "counselors_and_principal", body: "جلسهٴ اول: از افت نمرهٴ ریاضی نگران است. قرار شد برنامهٴ مطالعهٴ هفتگی بنویسد و هفتهٴ بعد با هم مرورش کنیم." },
    { kind: "family", visibility: "counselors", body: "تماس با مادر: خانواده تابستان جابه‌جا شده و هنوز به محلهٴ تازه عادت نکرده است. این یادداشت فقط برای مشاوران است." },
  ],
  [{ kind: "behavioral", visibility: "counselors_and_principal", body: "در دو هفتهٴ اخیر چند بار با تأخیر به زنگ اول رسیده است. گفت‌وگو شد؛ پیگیری با معاون پیشنهاد می‌شود." }],
  [{ kind: "general", visibility: "counselors_and_principal", body: "برای انتخاب رشتهٴ سال آینده مردد است؛ آزمون رغبت‌سنجی در آبان انجام شود." }],
];

/** The one sample report a teacher of the first picked student sends the counselor. */
export const SAMPLE_TEACHER_REPORT = { kind: "academic" as const, body: "در دو هفتهٴ گذشته تمرین‌ها را تحویل نداده و در کلاس کم‌حرف‌تر از قبل است." };

/** The one open «ارجاع به مدیریت» (about the second picked student). */
export const SAMPLE_REFERRAL = {
  subject: "غیبت‌های پیاپی و افت درسی",
  description: "در سه هفتهٴ گذشته چند روز غیبت داشته و نمره‌های کلاسی‌اش پایین آمده است. لطفاً در جلسهٴ هفتگی با ولی او هماهنگی شود.",
};

/** The counselor's students: the first student of the first, the middle and the last class (their student numbers). */
export function counselingPicks(spec: PilotOrgSpec, scale: number): Array<{ cls: string; studentNumber: string }> {
  const perClass = studentsPerClass(scale, spec);
  const indexes = [...new Set([0, Math.floor(spec.classes.length / 2), spec.classes.length - 1])];
  return indexes.map((ci) => ({ cls: spec.classes[ci].name, studentNumber: String(14051001 + ci * perClass) }));
}

/**
 * Through the real services with each actor's REAL ctx (scope rule + audit): the counselor's sample notes (one of
 * them «فقط مشاوران»), a teacher of the first picked student's class reporting on them, and the counselor's open
 * «ارجاع به مدیریت» about the second (an `admin_request` to the principal and the vice principal). Idempotent: notes
 * are counted per (student, author), the report and the referral looked up before they are written.
 */
async function seedCounseling(
  db: Db,
  orgId: string,
  spec: PilotOrgSpec,
  structure: { counselor: StaffOut; teachers: TeacherOut[]; allocation: string[][] },
  scale: number,
  ctxCache: Map<string, ActorCtx>,
): Promise<void> {
  await withOrg(db, orgId, async (tx) => {
    const cctx = await actorCtx(tx, orgId, structure.counselor.personId, ctxCache);
    const picked: Array<{ cls: string; studentProfileId: string }> = [];
    for (const p of counselingPicks(spec, scale)) {
      const [sp] = await tx.select({ id: studentProfile.id }).from(studentProfile).where(eq(studentProfile.studentNumber, p.studentNumber)).limit(1);
      if (sp) picked.push({ cls: p.cls, studentProfileId: sp.id });
    }
    for (const [i, s] of picked.entries()) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(counselorNote)
        .where(and(eq(counselorNote.studentProfileId, s.studentProfileId), eq(counselorNote.authorPersonId, structure.counselor.personId)));
      for (const note of (SAMPLE_NOTES[i] ?? []).slice(Number(n))) await createCounselorNote(tx, cctx, { studentProfileId: s.studentProfileId, ...note });
    }
    const first = picked[0];
    if (first) {
      const t = structure.allocation.findIndex((keys) => keys.some((key) => key.startsWith(`${first.cls}:`)));
      if (t !== -1) {
        const teacher = structure.teachers[t];
        const [has] = await tx
          .select({ id: teacherReport.id })
          .from(teacherReport)
          .where(and(eq(teacherReport.studentProfileId, first.studentProfileId), eq(teacherReport.authorPersonId, teacher.personId)))
          .limit(1);
        if (!has) await createTeacherReport(tx, await actorCtx(tx, orgId, teacher.personId, ctxCache), { studentProfileId: first.studentProfileId, ...SAMPLE_TEACHER_REPORT });
      }
    }
    const second = picked[1] ?? picked[0];
    if (second) {
      const [has] = await tx
        .select({ id: referral.id })
        .from(referral)
        .where(and(eq(referral.studentProfileId, second.studentProfileId), eq(referral.kind, "management")))
        .limit(1);
      if (!has) await referToManagement(tx, cctx, { studentProfileId: second.studentProfileId, subject: SAMPLE_REFERRAL.subject, description: SAMPLE_REFERRAL.description, urgent: false });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// «ارتباط ولی و مدرسه» (owner, 2026-10-19): the demo parent's sample messages
// ---------------------------------------------------------------------------------------------------------------

/**
 * The sample messages of a school's FIRST guardian (the plan's mother of two siblings — the «ولی» the demo dock offers
 * first) about her first child: a «سؤال» to the teacher of the child's first درس, ANSWERED by that teacher, and an
 * open «پیشنهاد» to the principal — so «پیام به مدرسه» shows both states and the bell its «پاسخ مدرسه …».
 */
export const SAMPLE_GUARDIAN_MESSAGES: ReadonlyArray<{ kind: MessageKind; destination: MessageDestination; subject: string; body: string; answer: string | null }> = [
  {
    kind: "question",
    destination: "teacher",
    subject: "تمرین‌های هفتهٴ گذشته",
    body: "سلام. فرزندم می‌گوید تمرین‌های فصل دوم در کلاس حل شده است؛ لطفاً بفرمایید کدام صفحه‌ها را در خانه مرور کند.",
    answer: "سلام. صفحه‌های ۲۴ تا ۳۰ را مرور کند و سه تمرین آخر را در دفترش بنویسد. در کلاس خوب پیش می‌رود.",
  },
  {
    kind: "suggestion",
    destination: "principal",
    subject: "زمان جلسهٴ اولیا",
    body: "پیشنهاد می‌کنم جلسه‌های اولیا عصر برگزار شود تا پدر و مادرهای شاغل هم بتوانند بیایند.",
    answer: null,
  },
];

/**
 * Through the real services with each actor's REAL ctx: the guardian sends (`sendGuardianMessage` — the live link, the
 * destinations of the child's school, the rate limit, the audit), the teacher answers in «پنل من» (`changeStatus`,
 * which tells the guardian). Idempotent: nothing is sent when that guardian already has a message about that child.
 */
async function seedGuardianMessages(db: Db, orgId: string, spec: PilotOrgSpec, ctxCache: Map<string, ActorCtx>): Promise<void> {
  await withOrg(db, orgId, async (tx) => {
    // The plan's first guardian is the one of the first student of the first class (`guardianPlan`, cls 0 / j 0).
    const [child] = await tx
      .select({ studentProfileId: studentProfile.id })
      .from(person)
      .innerJoin(studentProfile, eq(studentProfile.personId, person.id))
      .where(eq(person.externalRef, `pilot:${spec.key}:student:${14051001}`))
      .limit(1);
    if (!child) return;
    const [link] = await tx
      .select({ guardianPersonId: guardianLink.guardianPersonId })
      .from(guardianLink)
      .where(and(eq(guardianLink.studentProfileId, child.studentProfileId), eq(guardianLink.status, "active")))
      .orderBy(guardianLink.createdAt, guardianLink.guardianPersonId)
      .limit(1);
    if (!link) return;
    const [sent] = await tx
      .select({ id: guardianMessage.id })
      .from(guardianMessage)
      .where(and(eq(guardianMessage.guardianPersonId, link.guardianPersonId), eq(guardianMessage.studentProfileId, child.studentProfileId)))
      .limit(1);
    if (sent) return;
    const gctx = await actorCtx(tx, orgId, link.guardianPersonId, ctxCache);
    const teacher = (await childMessagesPage(tx, gctx, child.studentProfileId)).destinations.teachers[0];
    for (const m of SAMPLE_GUARDIAN_MESSAGES) {
      if (m.destination === "teacher" && !teacher) continue;
      const res = await sendGuardianMessage(tx, gctx, {
        studentProfileId: child.studentProfileId,
        kind: m.kind,
        destination: m.destination,
        classOfferingId: m.destination === "teacher" ? teacher.classOfferingId : null,
        teacherPersonId: m.destination === "teacher" ? teacher.teacherPersonId : null,
        subject: m.subject,
        body: m.body,
      });
      if (m.answer && m.destination === "teacher") {
        await changeStatus(tx, await actorCtx(tx, orgId, teacher.teacherPersonId, ctxCache), { workItemId: res.workItemId, toStatusCode: "answered", note: m.answer });
      }
    }
  });
}

export interface PilotCounts extends Record<string, number> {
  organizations: number;
  schools: number;
  students: number;
  workItems: number;
}

/** Global counts (as app_owner, per pilot organization so FORCE RLS lets us see the rows). */
export async function pilotCounts(db: Db): Promise<PilotCounts> {
  const totals: PilotCounts = {
    organizations: 0,
    schools: 0,
    classGroups: 0,
    offerings: 0,
    staff: 0,
    students: 0,
    accounts: 0,
    classEnrollments: 0,
    teacherAssignments: 0,
    timetableSlots: 0,
    attendanceSessions: 0,
    attendanceEntries: 0,
    objectiveRatings: 0,
    counselorNotes: 0,
    teacherReports: 0,
    referrals: 0,
    guardianLinks: 0,
    guardians: 0,
    guardianMessages: 0,
    workItems: 0,
    comments: 0,
    notifications: 0,
  };
  const orgs = await db.select({ id: organization.id }).from(organization).where(inArray(organization.slug, SEEDED_PILOT_ORGS.map((o) => o.slug)));
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
      totals.timetableSlots += await count("academic.timetable_slot");
      totals.attendanceSessions += await count("academic.attendance_session");
      totals.attendanceEntries += await count("academic.attendance_entry");
      totals.objectiveRatings += await count("academic.objective_rating");
      totals.counselorNotes += await count("counseling.counselor_note");
      totals.teacherReports += await count("counseling.teacher_report");
      totals.referrals += await count("counseling.referral");
      totals.guardianLinks += await count("iam.guardian_link", "where status = 'active'");
      // Guardian-only persons (a teacher who is also a parent is counted as staff): their accounts are memberships too.
      const guardians = await tx.execute<{ n: number }>(sql.raw("select (select count(*)::int from iam.person p where exists (select 1 from iam.guardian_link gl where gl.guardian_person_id = p.id) and not exists (select 1 from iam.student_profile sp where sp.person_id = p.id) and not exists (select 1 from iam.staff_profile st where st.person_id = p.id)) as n"));
      totals.guardians += guardians.rows[0].n;
      totals.guardianMessages += await count("workspace.guardian_message");
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
      and c.table_schema in ('tenancy','iam','academic','workspace','notif','files','audit','config','integ','counseling','ops')
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
  const orgs = await db.select({ id: organization.id, slug: organization.slug }).from(organization).where(inArray(organization.slug, SEEDED_PILOT_ORGS.map((o) => o.slug)));
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
  for (const spec of SEEDED_PILOT_ORGS) summaries.push(await seedPilotOrg(db, spec, { password, scale, roleIds: { org_admin: roles[0].id } }, secretHash));
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
    if (s.primary) {
      lines.push(
        "دبستان (پایهٔ اول تا ششم، یک کلاس در هر پایه). «کارنامهٴ توصیفی» در خانهٔ آموزگار، مدیر و معاون؛ «کارنامهٴ من» در خانهٔ دانش‌آموز. کارنامهٴ ماه مهر به‌عنوان نمونه ثبت شده است (چند برگه عمداً خالی مانده‌اند).",
        "",
      );
    }
    lines.push("| نقش | نام | ورود |", "|---|---|---|");
    lines.push(`| مدیر سازمان | ${s.admin.name} | \`${national(s.admin.phone)}\` |`);
    lines.push(`| مدیر مدرسه | ${s.principal.name} | \`${national(s.principal.phone)}\` |`);
    lines.push(`| معاون | ${s.vice.name} | \`${national(s.vice.phone)}\` |`);
    if (s.counselor) lines.push(`| مشاور | ${s.counselor.name} | \`${national(s.counselor.phone)}\` |`);
    lines.push("");
    if (s.counselor) {
      lines.push(
        "«مشاوره» در خانهٴ مشاور، مدیر و معاون: پروندهٴ چند دانش‌آموز با یادداشت نمونه (یکی «فقط مشاوران»)، یک گزارش دبیر و یک «ارجاع به مدیریت» باز که در «پنل من» مدیر و معاون است.",
        "",
      );
    }
    lines.push("### دبیران", "", "| نام | ورود | درس‌ها |", "|---|---|---|");
    for (const t of s.teachers) lines.push(`| ${t.name} | \`${national(t.phone)}\` | ${t.offerings.join("، ")} |`);
    lines.push("", "### دانش‌آموزان (سه نفر اول هر کلاس)", "", "| کلاس | نام | ورود |", "|---|---|---|");
    for (const c of s.classes) for (const st of c.students) lines.push(`| ${c.name} | ${st.name} | \`${loginId(st.loginIdentifier)}\` |`);
    lines.push("");
    if (s.guardians.length > 0) {
      lines.push("### اولیا", "", "ولی با همان رمز وارد می‌شود و در خانه کارت هر فرزند را می‌بیند (تکالیف، حضور و غیاب، کارنامه، برنامهٴ کلاسی؛ فقط مشاهده).", "", "| ولی | فرزندان | ورود |", "|---|---|---|");
      for (const g of s.guardians) lines.push(`| ${g.name}${g.teacher ? " (دبیر همین مدرسه)" : ""} | ${g.children.join("، ")} | \`${loginId(g.loginIdentifier)}\` |`);
      lines.push("");
    }
    lines.push(
      `شمارش: ${s.counts.classGroups} کلاس، ${s.counts.offerings} ارائهٴ درس، ${s.counts.staff} همکار، ${s.counts.students} دانش‌آموز، ${s.counts.accounts} حساب، ${s.counts.teacherAssignments} تخصیص دبیر، ${s.counts.timetableSlots} زنگ برنامه، ${s.counts.workItems} کار، ${s.counts.comments} نظر، ${s.counts.notifications} اعلان.`,
      "",
    );
  }
  return lines.join("\n");
}

function printSummary(result: SeedPilotResult): void {
  for (const s of result.summaries) {
    console.log(`\n[seed:pilot] ${s.org} / ${s.school} (${s.code}) — ${s.counts.createdAccounts} accounts created this run`);
    console.log(
      `  ${s.counts.classGroups} classes, ${s.counts.offerings} offerings, ${s.counts.staff} staff, ${s.counts.students} students, ${s.counts.accounts} accounts, ${s.counts.classEnrollments} enrollments, ${s.counts.teacherAssignments} teacher assignments, ${s.counts.timetableSlots} timetable slots, ${s.counts.workItems} work items, ${s.counts.assignees} assignees, ${s.counts.comments} comments, ${s.counts.notifications} notifications`,
    );
    console.log(`  phases: structure+staff ${(s.counts.structureMs / 1000).toFixed(1)} s · students ${(s.counts.studentsMs / 1000).toFixed(1)} s · teacher tasks + student reactions ${(s.counts.teacherItemsMs / 1000).toFixed(1)} s · staff items ${(s.counts.staffItemsMs / 1000).toFixed(1)} s`);
    console.log(`  admin ${s.admin.name} ${national(s.admin.phone)} · principal ${s.principal.name} ${national(s.principal.phone)} · vice ${s.vice.name} ${national(s.vice.phone)}`);
    if (s.counselor) console.log(`  counselor ${s.counselor.name} ${national(s.counselor.phone)} · ${s.counts.counselorNotes} notes, ${s.counts.teacherReports} teacher reports, ${s.counts.referrals} referrals`);
    for (const t of s.teachers) console.log(`  teacher ${t.name.padEnd(22)} ${national(t.phone)}  ${t.offerings.join("، ")}`);
    for (const c of s.classes) console.log(`  class ${c.name}: ${c.students.map((st) => `${st.name} (${loginId(st.loginIdentifier)})`).join(" · ")}`);
    for (const g of s.guardians) console.log(`  guardian ${g.name.padEnd(22)} ${loginId(g.loginIdentifier)}${g.teacher ? " (teacher)" : ""}  ${g.children.join("، ")}`);
  }
  console.log(`\n[seed:pilot] password for every pilot account: ${result.password}  (scale ${result.scale}, ${(result.ms / 1000).toFixed(1)} s)`);
}

// ---------------------------------------------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------------------------------------------

export function loadDotEnv(): void {
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
    // PILOT_ACCOUNTS_DIR: where the sheet goes when cwd is not writable (the bundled run inside the image, /app).
    const dir = path.resolve(process.cwd(), process.env.PILOT_ACCOUNTS_DIR ?? "backups");
    const out = path.join(dir, "pilot-accounts.md");
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(out, renderAccountsMarkdown(result), { encoding: "utf8", mode: 0o600 });
      console.log(`[seed:pilot] accounts sheet → ${out}`);
    } catch (err) {
      // The data is committed by now; a read-only cwd must not turn a good seed into a failed run.
      console.warn(`[seed:pilot] accounts sheet NOT written (${err instanceof Error ? err.message : String(err)}) — set PILOT_ACCOUNTS_DIR to a writable directory`);
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
      console.error("[seed:pilot] FAILED:", err instanceof Error ? err.stack ?? err.message : err);
      process.exit(1);
    });
}
