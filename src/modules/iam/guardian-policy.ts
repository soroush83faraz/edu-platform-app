// iam/guardian-policy — the pure rules of «اولیا» (owner, 2026-10-18; docs/decisions.md «اولیا — فاز ۱»): relations and
// their Persian labels, which child a guardian page shows, the generated username of a guardian whose phone cannot be
// their login, the bulk placeholder name, the demo dock's labels and the guardian bell's titles. No I/O, no imports
// with side effects — unit-tested in tests/unit/guardian-policy.test.ts; the service (./guardian) and the views
// (./guardian-views) decide everything that needs the database.
import { formatNumberFa } from "@/lib/format";

/** `guardian_link.relation` — mirrors `guardian_link_relation_chk` (migration 0020). */
export const GUARDIAN_RELATIONS = ["father", "mother", "guardian", "other"] as const;
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

export const RELATION_LABELS: Record<GuardianRelation, string> = {
  father: "پدر",
  mother: "مادر",
  guardian: "سرپرست",
  other: "سایر",
};

export function isGuardianRelation(value: string): value is GuardianRelation {
  return (GUARDIAN_RELATIONS as readonly string[]).includes(value);
}

/** «پدر» / «مادر» / «سرپرست» / «سایر»; an unknown value (never written — the CHECK refuses it) reads «سایر». */
export function relationLabel(value: string): string {
  return isGuardianRelation(value) ? RELATION_LABELS[value] : RELATION_LABELS.other;
}

/**
 * The ONE sentence for an account the caller may not act AS (security review 2026-10-19, D1 — `requireCredentialReach`
 * in ./guardian): «تعیین رمز موقت», «رفع قفل», «ساخت حساب کاربری» or a sheet's initial password of a person who is the
 * guardian of a child outside the caller's scope (a colleague with a child at another school, a parent with children
 * at two schools). Deliberately says nothing about where — or whether — that person has children.
 */
export const CREDENTIALS_ORG_ADMIN_ONLY = "رمز و حساب کاربری این فرد را فقط مدیر سازمان تعیین می‌کند.";

/**
 * What happened to the login when a guardian was added (./guardian `addGuardian`) — the admin UI says it in one line.
 * `linked` is the neutral outcome (security review 2026-10-19, D3): the phone led to an existing person the caller's
 * schools do not already know (another school's parent, a colleague of another school, such a parent's closed
 * account reopened) — the link is made, but nothing about that person is echoed: not their name, not that they are a
 * colleague, not that they had children elsewhere. «ثبت‌شده» says no more than «این شماره قبلاً ثبت شده است» already
 * does on every account form.
 */
export type GuardianAccountKind = "new_phone" | "new_username" | "existing" | "reopened" | "staff" | "linked";

export const GUARDIAN_ACCOUNT_NOTES: Record<GuardianAccountKind, string> = {
  new_phone: "حساب ولی با همین شماره ساخته شد.",
  new_username: "این شماره نام‌کاربری حساب دیگری است (مثلاً حساب یک دانش‌آموز)؛ برای ولی نام‌کاربری جداگانه ساخته شد.",
  existing: "این ولی از پیش حساب دارد (برای فرزند دیگری)؛ همان حساب به این دانش‌آموز هم وصل شد.",
  reopened: "دسترسی این ولی دوباره باز شد؛ رمز اولیهٴ تازه دارد.",
  staff: "این شماره حساب یکی از همکاران است؛ نقش «ولی» به همان حساب افزوده شد.",
  linked: "شمارهٴ ثبت‌شده؛ اتصال انجام شد.",
};

/** What the bulk «ساخت حساب اولیا» writes for a guardian whose relation nobody told the school. */
export const BULK_RELATION: GuardianRelation = "guardian";

/**
 * The child a guardian page shows (`?child=<studentProfileId>`). `children` are the guardian's LIVE children as the
 * server read them; the request is only ever a CHOICE among them: none requested → the first child; a requested id
 * that is not one of them → null, and the page answers NOT_FOUND — it never falls back to another child, so a tampered
 * or stale link cannot quietly show a different one. No children at all → null.
 */
export function pickChild<T extends { studentProfileId: string }>(children: readonly T[], requested: string | null | undefined): T | null {
  if (children.length === 0) return null;
  if (requested === undefined || requested === null || requested === "") return children[0];
  return children.find((c) => c.studentProfileId === requested) ?? null;
}

/** `?child=` as the pages receive it: one UUID, or nothing (an array, garbage or a missing value → nothing). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function childParam(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  return UUID_RE.test(raw) ? raw.toLowerCase() : undefined;
}

/**
 * The login of a guardian whose phone is ALREADY someone else's login — a student who signs in with the parent's
 * number, an account elsewhere — so it can never be the guardian's: `<school code>-v-<student number>` of the child
 * it was created for (the student convention `<school code>-<student number>`, «v» for ولی), lower-cased; the account
 * service adds `-01`…`-05` when even that is taken (login identifiers are global, school codes per organization).
 * Starts with a letter (school codes do), so login never reads it as a phone.
 */
export function guardianUsernameBase(schoolCode: string, studentNumber: string): string {
  return `${schoolCode.toLowerCase()}-v-${studentNumber.toLowerCase()}`;
}

/**
 * The bulk creator knows the guardian's PHONE (the student's «ولی» contact point), never their name: the person is
 * named after the child — «ولیِ لیلا» «نیک‌خواه» reads «ولیِ لیلا نیک‌خواه» everywhere (greeting, the student's
 * «اولیا» card, the sheet). Adding the same phone on the student page with a real name replaces it (`addGuardian`).
 */
export function placeholderGuardianName(child: { firstName: string; lastName: string }): { firstName: string; lastName: string } {
  return { firstName: `ولیِ ${child.firstName}`, lastName: child.lastName };
}

/**
 * The «حساب» line of a guardian in the demo dock: «ولیِ لیلا نیک‌خواه — اول الف» for one child at that school,
 * «ولیِ ۲ فرزند: لیلا نیک‌خواه، سارا نیک‌خواه» for several (names in the order given).
 */
export function guardianDemoLabel(children: ReadonlyArray<{ name: string; className: string | null }>): string {
  if (children.length === 1) {
    const c = children[0];
    return c.className ? `ولیِ ${c.name} — ${c.className}` : `ولیِ ${c.name}`;
  }
  return `ولیِ ${formatNumberFa(children.length)} فرزند: ${children.map((c) => c.name).join("، ")}`;
}

/** The guardian bell's events (scripts/catalog.ts `guardian.*`). */
export type GuardianEvent = "absent" | "report_card";

/**
 * Title of a guardian's notification: the kind of event and the child's name — nothing else (no درس, no زنگ, no
 * teacher's note, no level): «غیبت: لیلا نیک‌خواه», «کارنامهٴ ماه مهر: لیلا نیک‌خواه». No body is ever written.
 */
export function guardianNotificationTitle(event: GuardianEvent, childName: string, monthName?: string): string {
  if (event === "absent") return `غیبت: ${childName}`;
  return monthName ? `کارنامهٴ ماه ${monthName}: ${childName}` : `کارنامهٴ ماهانه: ${childName}`;
}

/** The guardian pages (`/child/*`), always naming the child. */
export type ChildPage = "work" | "attendance" | "report-card" | "timetable";

export function childHref(page: ChildPage, studentProfileId: string, extra?: Record<string, string | number>): string {
  const q = new URLSearchParams({ child: studentProfileId });
  for (const [k, v] of Object.entries(extra ?? {})) q.set(k, String(v));
  return `/child/${page}?${q.toString()}`;
}

/** Home with this child selected (the cards are the switch, the tiles below follow the selection). */
export function homeChildHref(studentProfileId: string): string {
  return `/home?child=${studentProfileId}`;
}
