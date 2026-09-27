// Pure plan of the demo extras (scripts/seed-demo-extras.ts): WHAT every role of a pilot organization gets in «پنل من»
// and in the bell — the items, their deadlines relative to now (Asia/Tehran), who marks what done, what the giver
// closes or extends and which notifications are read — plus the deterministic helpers the runner and the unit test
// share (tests/unit/demo-extras-plan.test.ts). Import-free apart from node's crypto and the shared Tehran day math.
import { createHash } from "node:crypto";
import { TEHRAN_OFFSET_MS, tehranDayStart } from "../src/lib/format";

// ---------------------------------------------------------------------------------------------------------------
// deterministic helpers
// ---------------------------------------------------------------------------------------------------------------

/**
 * The stable marker of one planned item: a v7-shaped UUID from `(organization key, slug)`, stored in
 * `work_item.idempotency_key` (unique per organization + creator). The runner looks the item up by
 * (creator, key) with NO time window before creating it, so a second run — or a run a month later — finds it.
 * The `edu-demo-extras:` salt keeps these keys apart from every pilot id (`pilotId`, salt `edu-pilot:`).
 */
export function demoItemKey(orgKey: string, slug: string): string {
  const h = createHash("sha256").update(`edu-demo-extras:${orgKey}:${slug}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A deadline relative to the Tehran calendar day of «now»: `days` later (negative = overdue) at `at` Tehran time. */
export interface DueSpec {
  days: number;
  /** "HH:MM", Tehran wall clock. */
  at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC instant of `due` (null → no deadline). «Today» at 23:30 stays «امروز» for the whole demo day. */
export function demoDueAt(due: DueSpec | null, now = new Date()): Date | null {
  if (!due) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(due.at);
  if (!m) throw new Error(`demo extras: bad time ${due.at}`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return new Date(tehranDayStart(now).getTime() + due.days * DAY_MS + minutes * 60_000);
}

/** The Tehran calendar day ("YYYY-MM-DD") of an instant — what the unit test checks the spread against. */
export function tehranIsoDay(instant: Date): string {
  return new Date(instant.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The students of a class who «did» a homework: the first `share` of the roster in a stable order (sorted ids),
 * at least one and never the whole class — so the teacher reads a real n/m on the item.
 */
export function pickDoers(personIds: readonly string[], share: number): string[] {
  if (personIds.length < 2 || share <= 0) return [];
  const n = Math.min(personIds.length - 1, Math.max(1, Math.round(personIds.length * share)));
  return [...personIds].sort().slice(0, n);
}

/** The old notification wording (before «تکلیف» / «تسک»): «کار جدید: …». */
export const LEGACY_NEW_PREFIX = "کار جدید: ";

/** «کار جدید: X» → «<the creator's word>: X» (e.g. «تکلیف جدید: X»); null when the title is not a legacy one. */
export function renameLegacyTitle(title: string, newWord: string): string | null {
  if (!title.startsWith(LEGACY_NEW_PREFIX)) return null;
  return `${newWord}: ${title.slice(LEGACY_NEW_PREFIX.length)}`.slice(0, 200);
}

// ---------------------------------------------------------------------------------------------------------------
// the plan
// ---------------------------------------------------------------------------------------------------------------

/**
 * A pilot person by role: `admin`, `principal`, `vice`, `teacher-<1..10>` (external_ref `pilot:<org>:<ref>`) or
 * `student-<n>` — the n-th student of the organization (external_ref `pilot:<org>:student:<14051001+n>`;
 * `student-0` is the first student of the first class, phone 0935X001000).
 */
export type PersonRef = "admin" | "principal" | "vice" | `teacher-${number}` | `student-${number}`;

/** Names the runner fills in from the organization: the class's درس and کلاس, and the school's science درس. */
export interface TitleVars {
  subject: string;
  cls: string;
  science: string;
}

export type DemoRecipients =
  | { kind: "self" }
  | { kind: "persons"; who: PersonRef[] }
  /** The class of the actor's n-th teaching offering (their offerings in a stable order, index taken modulo). */
  | { kind: "class"; offeringIndex: number };

export interface DemoItemSpec {
  /** Stable part of the idempotency key — never rename an existing slug. */
  slug: string;
  actor: PersonRef;
  typeCode: "task" | "todo";
  title: string | ((v: TitleVars) => string);
  description: string | null;
  priority: "normal" | "high";
  due: DueSpec | null;
  recipients: DemoRecipients;
  /** Assignees who mark it «انجام شد» (silent — the giver reads n/m). */
  doneBy?: PersonRef[];
  /** For a class item: the share of the class that marks it done (`pickDoers`). */
  doneShare?: number;
  /** The giver's «اتمام» after the assignees' marks (notifies every other assignee). */
  closeByGiver?: boolean;
  /** The giver's «تمدید» to this later deadline (notifies every assignee). */
  extendTo?: DueSpec;
  /** Assignees who have OPENED it (their notifications of this item read) without finishing it. */
  readBy?: PersonRef[];
}

const TEACHERS_ALL: PersonRef[] = ["teacher-1", "teacher-2", "teacher-3", "teacher-4", "teacher-5", "teacher-6", "teacher-7", "teacher-8", "teacher-9", "teacher-10"];

/** Every organization gets the same plan (titles are school-neutral; class items name the درس and کلاس). */
export const DEMO_ITEMS: DemoItemSpec[] = [
  // ---- organization admin → principal and vice principal («تسک») ----
  {
    slug: "admin:attendance-report",
    actor: "admin",
    typeCode: "task",
    title: "ارسال گزارش حضور و غیاب ماهانه",
    description: "گزارش حضور و غیاب ماه جاری را از بخش حضور و غیاب بگیرید و برای دفتر مجتمع بفرستید.",
    priority: "high",
    due: { days: -2, at: "14:00" },
    recipients: { kind: "persons", who: ["principal", "vice"] },
    readBy: ["principal"],
  },
  {
    slug: "admin:parents-meeting",
    actor: "admin",
    typeCode: "task",
    title: "هماهنگی جلسهٴ اولیا و مربیان",
    description: "زمان، مکان و دستور جلسه را هماهنگ کنید و دعوت‌نامه را برای اولیا بفرستید.",
    priority: "normal",
    due: { days: 0, at: "23:30" },
    recipients: { kind: "persons", who: ["principal"] },
    doneBy: ["principal"],
  },
  {
    slug: "admin:exam-schedule",
    actor: "admin",
    typeCode: "task",
    title: "بازبینی برنامهٴ امتحانات نوبت اول",
    description: "برنامهٴ پیشنهادی امتحانات را با دبیران هر پایه مرور کنید و تداخل‌ها را گزارش دهید.",
    priority: "normal",
    due: { days: -1, at: "12:00" },
    recipients: { kind: "persons", who: ["principal", "vice"] },
    extendTo: { days: 4, at: "20:00" },
  },
  {
    slug: "admin:staff-list",
    actor: "admin",
    typeCode: "task",
    title: "به‌روزرسانی فهرست کارکنان",
    description: "شمارهٴ تماس و سمت همکاران جدید را در فهرست کارکنان ثبت کنید.",
    priority: "normal",
    due: null,
    recipients: { kind: "persons", who: ["principal", "vice"] },
    doneBy: ["vice"],
    closeByGiver: true,
  },

  // ---- principal → دبیران of the school («تسک») ----
  {
    slug: "principal:lesson-plan",
    actor: "principal",
    typeCode: "task",
    title: "ارسال طرح درس ماهانه",
    description: "طرح درس ماه آینده را برای هر کلاس آماده کنید و برای دفتر آموزش بفرستید.",
    priority: "normal",
    due: { days: 4, at: "20:00" },
    recipients: { kind: "persons", who: TEACHERS_ALL },
    doneBy: ["teacher-2", "teacher-5", "teacher-7"],
  },
  {
    slug: "principal:council-meeting",
    actor: "principal",
    typeCode: "task",
    title: "شرکت در جلسهٴ شورای دبیران",
    description: "ساعت ۱۰ صبح در دفتر مدرسه؛ گزارش کوتاهی از پیشرفت کلاس‌هایتان همراه داشته باشید.",
    priority: "normal",
    due: { days: 0, at: "23:30" },
    recipients: { kind: "persons", who: TEACHERS_ALL },
    readBy: ["teacher-1"],
  },
  {
    slug: "principal:midterm-questions",
    actor: "principal",
    typeCode: "task",
    title: "تحویل سؤالات امتحان میان‌نوبت",
    description: "سؤالات را همراه با پاسخ‌نامه و بارم‌بندی تحویل دفتر آموزش دهید.",
    priority: "high",
    due: { days: -1, at: "14:00" },
    recipients: { kind: "persons", who: ["teacher-1", "teacher-2", "teacher-3", "teacher-4", "teacher-5"] },
    extendTo: { days: 3, at: "20:00" },
  },
  {
    slug: "principal:reference-books",
    actor: "principal",
    typeCode: "task",
    title: "معرفی کتاب‌های کمک‌آموزشی مناسب هر پایه",
    description: "برای هر پایه حداکثر دو کتاب پیشنهاد دهید تا در فهرست کتابخانه قرار گیرد.",
    priority: "normal",
    due: { days: -3, at: "14:00" },
    recipients: { kind: "persons", who: ["teacher-1", "teacher-2", "teacher-3"] },
    doneBy: ["teacher-1", "teacher-2"],
    closeByGiver: true,
  },

  // ---- vice principal → a few دبیران («تسک») ----
  {
    slug: "vice:remedial-list",
    actor: "vice",
    typeCode: "task",
    title: "تحویل فهرست دانش‌آموزان نیازمند کلاس جبرانی",
    description: "نام دانش‌آموزانی را که به کلاس جبرانی نیاز دارند با ذکر درس بنویسید.",
    priority: "normal",
    due: { days: 2, at: "20:00" },
    recipients: { kind: "persons", who: ["teacher-1", "teacher-2", "teacher-4"] },
    doneBy: ["teacher-4"],
  },
  {
    slug: "vice:field-trip",
    actor: "vice",
    typeCode: "task",
    title: "همراهی در اردوی علمی دانش‌آموزان",
    description: "برای همراهی در اردوی علمی ماه آینده اعلام آمادگی کنید.",
    priority: "normal",
    due: { days: 9, at: "20:00" },
    recipients: { kind: "persons", who: ["teacher-3", "teacher-6"] },
  },

  // ---- personal notes («یادداشت شخصی») of the managers ----
  { slug: "admin:note:bus", actor: "admin", typeCode: "todo", title: "تماس با مسئول سرویس مدارس", description: null, priority: "normal", due: { days: 1, at: "11:00" }, recipients: { kind: "self" } },
  { slug: "admin:note:lab", actor: "admin", typeCode: "todo", title: "بررسی پیش‌فاکتور تجهیزات آزمایشگاه", description: null, priority: "normal", due: null, recipients: { kind: "self" }, doneBy: ["admin"] },
  { slug: "principal:note:heating", actor: "principal", typeCode: "todo", title: "پیگیری تعمیر سیستم گرمایش کلاس‌ها", description: null, priority: "high", due: { days: 0, at: "23:30" }, recipients: { kind: "self" } },
  { slug: "principal:note:assembly", actor: "principal", typeCode: "todo", title: "آماده کردن متن صحبت مراسم صبحگاه", description: null, priority: "normal", due: { days: 3, at: "07:30" }, recipients: { kind: "self" }, doneBy: ["principal"] },
  { slug: "vice:note:absences", actor: "vice", typeCode: "todo", title: "پیگیری غیبت‌های مکرر این هفته", description: null, priority: "high", due: { days: -1, at: "13:00" }, recipients: { kind: "self" } },
  { slug: "vice:note:trip-bus", actor: "vice", typeCode: "todo", title: "هماهنگی سرویس اردو با انجمن اولیا", description: null, priority: "normal", due: { days: 5, at: "12:00" }, recipients: { kind: "self" } },

  // ---- students' own «تسک» (the first few students) ----
  { slug: "student-0:review", actor: "student-0", typeCode: "todo", title: (v) => `مرور فصل ۳ ${v.science}`, description: null, priority: "normal", due: { days: 1, at: "21:00" }, recipients: { kind: "self" } },
  { slug: "student-0:math-exam", actor: "student-0", typeCode: "todo", title: "آماده شدن برای آزمون ریاضی", description: null, priority: "high", due: { days: 4, at: "08:00" }, recipients: { kind: "self" } },
  { slug: "student-1:english-words", actor: "student-1", typeCode: "todo", title: "تمرین لغت‌های درس ۲ زبان انگلیسی", description: null, priority: "normal", due: { days: 0, at: "23:30" }, recipients: { kind: "self" } },
  { slug: "student-1:math-extra", actor: "student-1", typeCode: "todo", title: "حل تمرین‌های اضافهٴ ریاضی", description: null, priority: "normal", due: null, recipients: { kind: "self" }, doneBy: ["student-1"] },
  { slug: "student-2:literature", actor: "student-2", typeCode: "todo", title: "خلاصه‌نویسی درس ۲ ادبیات فارسی", description: null, priority: "normal", due: { days: -1, at: "21:00" }, recipients: { kind: "self" } },
  { slug: "student-3:review", actor: "student-3", typeCode: "todo", title: (v) => `مرور فصل ۳ ${v.science}`, description: null, priority: "normal", due: { days: 2, at: "21:00" }, recipients: { kind: "self" }, doneBy: ["student-3"] },

  // ---- the first دبیر (0935X000011): a mix of «تکلیف» — partly done, closed, extended ----
  {
    slug: "teacher-1:extra-problems",
    actor: "teacher-1",
    typeCode: "task",
    title: (v) => `حل مسائل تکمیلی — ${v.subject} ${v.cls}`,
    description: "مسائل تکمیلی جزوه را حل کنید؛ راه‌حل را کامل بنویسید.",
    priority: "normal",
    due: { days: 2, at: "20:00" },
    recipients: { kind: "class", offeringIndex: 0 },
    doneShare: 0.4,
  },
  {
    slug: "teacher-1:chapter-review",
    actor: "teacher-1",
    typeCode: "task",
    title: (v) => `جمع‌بندی فصل ۱ — ${v.subject} ${v.cls}`,
    description: "یک صفحه جمع‌بندی از مهم‌ترین نکته‌های فصل ۱ بنویسید.",
    priority: "normal",
    due: { days: -3, at: "14:00" },
    recipients: { kind: "class", offeringIndex: 1 },
    doneShare: 0.6,
    closeByGiver: true,
  },
  {
    slug: "teacher-1:class-report",
    actor: "teacher-1",
    typeCode: "task",
    title: (v) => `گزارش فعالیت کلاسی — ${v.subject} ${v.cls}`,
    description: "گزارش فعالیت گروهی جلسهٴ گذشته را کامل کنید و تحویل دهید.",
    priority: "high",
    due: { days: -1, at: "14:00" },
    recipients: { kind: "class", offeringIndex: 2 },
    doneShare: 0.2,
    extendTo: { days: 2, at: "20:00" },
  },
];

/** Every person a plan names (the runner resolves them all up front, before any write). */
export function planPersons(items: readonly DemoItemSpec[] = DEMO_ITEMS): PersonRef[] {
  const out = new Set<PersonRef>();
  for (const it of items) {
    out.add(it.actor);
    if (it.recipients.kind === "persons") for (const p of it.recipients.who) out.add(p);
    for (const p of it.doneBy ?? []) out.add(p);
    for (const p of it.readBy ?? []) out.add(p);
  }
  return [...out];
}

/** `pilot:<org>:<…>` external_ref of a person reference (students by their number, 14051001 + n). */
export function externalRefOf(orgKey: string, ref: PersonRef): string {
  const student = /^student-(\d+)$/.exec(ref);
  return student ? `pilot:${orgKey}:student:${14051001 + Number(student[1])}` : `pilot:${orgKey}:${ref}`;
}

export function titleOf(spec: DemoItemSpec, vars: TitleVars): string {
  return typeof spec.title === "function" ? spec.title(vars) : spec.title;
}
