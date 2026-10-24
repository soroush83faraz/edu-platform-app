// Pure rules of «مرخصی و خروج مجاز» (owner, 2026-10-20; docs/attendance.md «مرخصی و خروج مجاز»): the guardian's
// «درخواست مرخصی / غیبت موجه» for a child, and the school's «خروج مجاز» (an authorized early exit). No I/O and no
// Date-dependent globals — every function takes `now` — so the unit tests (tests/unit/leave.test.ts) pin a fixed
// Tehran instant. The services decide everything that needs the database (src/modules/iam/guardian-leave.ts,
// src/modules/academic/leave.ts); the database repeats the bounds as CHECKs (migration 0029).
import { daysBetweenIso, isValidIsoDate, tehranToday } from "@/lib/attendance";
import { formatNumberFa, isoDateToJalali } from "@/lib/format";

/** `leave_request.category` — mirrors `leave_request_category_chk`. */
export const LEAVE_CATEGORIES = ["illness", "family", "travel", "appointment", "other"] as const;
export type LeaveCategory = (typeof LEAVE_CATEGORIES)[number];

export const LEAVE_CATEGORY_LABELS: Record<LeaveCategory, string> = {
  illness: "بیماری",
  family: "امور خانوادگی",
  travel: "مسافرت",
  appointment: "قرار پزشکی یا اداری",
  other: "سایر",
};

/** `early_exit.category` — mirrors `early_exit_category_chk`. */
export const EARLY_EXIT_CATEGORIES = ["illness", "family", "appointment", "emergency", "other"] as const;
export type EarlyExitCategory = (typeof EARLY_EXIT_CATEGORIES)[number];

export const EARLY_EXIT_CATEGORY_LABELS: Record<EarlyExitCategory, string> = {
  illness: "بیماری",
  family: "امور خانوادگی",
  appointment: "قرار پزشکی یا اداری",
  emergency: "اورژانسی",
  other: "سایر",
};

/** `leave_request.status` — mirrors `leave_request_status_chk`. Only `approved` changes a roll call. */
export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "در انتظار بررسی",
  approved: "تأییدشده",
  rejected: "ردشده",
  cancelled: "لغوشده",
};

/** The `Chip` tone of each status (the product's four semantic tones). */
export const LEAVE_STATUS_TONES: Record<LeaveStatus, "success" | "danger" | "warning" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export function isLeaveCategory(v: unknown): v is LeaveCategory {
  return typeof v === "string" && (LEAVE_CATEGORIES as readonly string[]).includes(v);
}
export function isEarlyExitCategory(v: unknown): v is EarlyExitCategory {
  return typeof v === "string" && (EARLY_EXIT_CATEGORIES as readonly string[]).includes(v);
}
export function isLeaveStatus(v: unknown): v is LeaveStatus {
  return typeof v === "string" && (LEAVE_STATUSES as readonly string[]).includes(v);
}

export const leaveCategoryLabel = (v: string): string => (isLeaveCategory(v) ? LEAVE_CATEGORY_LABELS[v] : LEAVE_CATEGORY_LABELS.other);
export const earlyExitCategoryLabel = (v: string): string => (isEarlyExitCategory(v) ? EARLY_EXIT_CATEGORY_LABELS[v] : EARLY_EXIT_CATEGORY_LABELS.other);
export const leaveStatusLabel = (v: string): string => (isLeaveStatus(v) ? LEAVE_STATUS_LABELS[v] : v);

/** The longest leave (inclusive days), the notes' bounds and the pickup name's — also CHECKs in migration 0029. */
export const LEAVE_MAX_DAYS = 14;
export const LEAVE_NOTE_MAX = 300;
export const LEAVE_DECISION_NOTE_MAX = 300;
export const EARLY_EXIT_NOTE_MAX = 300;
export const EARLY_EXIT_PICKUP_MAX = 60;
/** The highest زنگ number (`attendance_session_period_chk`, `school_period`). */
export const LEAVE_MAX_PERIOD = 12;
/** A child may have at most this many requests waiting for the school at once. */
export const LEAVE_MAX_PENDING = 5;

export const LEAVE_MESSAGES = {
  badDate: "تاریخ نامعتبر است.",
  pastDate: "تاریخ شروع مرخصی نمی‌تواند پیش از امروز باشد.",
  badRange: "تاریخ پایان باید همان روز شروع یا پس از آن باشد.",
  tooLong: `مرخصی حداکثر ${formatNumberFa(LEAVE_MAX_DAYS)} روز می‌شود.`,
  periodsPair: "برای مرخصی بخشی از روز، هم زنگ شروع و هم زنگ پایان را انتخاب کنید.",
  periodsOrder: "زنگ پایان باید همان زنگ شروع یا پس از آن باشد.",
  periodsOneDay: "مرخصی بخشی از روز فقط برای یک روز ممکن است.",
  periodUnknown: "این زنگ در برنامهٴ کلاسی مدرسه وجود ندارد.",
  noteTooLong: `توضیح حداکثر ${formatNumberFa(LEAVE_NOTE_MAX)} نویسه است.`,
  overlap: "برای این بازه درخواست دیگری (در انتظار یا تأییدشده) ثبت شده است.",
  tooManyPending: `حداکثر ${formatNumberFa(LEAVE_MAX_PENDING)} درخواست در انتظار بررسی برای یک فرزند ممکن است.`,
  noSchool: "این دانش‌آموز در حال حاضر در مدرسه‌ای ثبت‌نام فعال ندارد.",
  notPending: "این درخواست دیگر در انتظار بررسی نیست.",
  decisionNoteTooLong: `توضیح حداکثر ${formatNumberFa(LEAVE_DECISION_NOTE_MAX)} نویسه است.`,
  badTime: "ساعت نامعتبر است.",
  exitExists: "برای این دانش‌آموز امروز خروج مجاز ثبت شده است؛ ابتدا آن را لغو کنید.",
  exitNotActive: "این خروج مجاز دیگر فعال نیست.",
  pickupTooLong: `نام تحویل‌گیرنده حداکثر ${formatNumberFa(EARLY_EXIT_PICKUP_MAX)} نویسه است.`,
  /** The school's feature switch `leave_requests` is off (src/modules/config/flags.ts). */
  switchedOff: "درخواست مرخصی در مدرسهٴ این دانش‌آموز فعال نیست.",
} as const;

/** The first problem of a leave's dates / periods, or null. `today` is the Tehran date the request is made on. */
export function validateLeaveRange(
  input: { fromDate: string; toDate: string; fromPeriod?: number | null; toPeriod?: number | null },
  now = new Date(),
): { field: "fromDate" | "toDate" | "fromPeriod" | "toPeriod"; message: string } | null {
  const { fromDate, toDate } = input;
  if (!isValidIsoDate(fromDate)) return { field: "fromDate", message: LEAVE_MESSAGES.badDate };
  if (!isValidIsoDate(toDate)) return { field: "toDate", message: LEAVE_MESSAGES.badDate };
  if (fromDate < tehranToday(now)) return { field: "fromDate", message: LEAVE_MESSAGES.pastDate };
  if (toDate < fromDate) return { field: "toDate", message: LEAVE_MESSAGES.badRange };
  if (leaveDays(fromDate, toDate) > LEAVE_MAX_DAYS) return { field: "toDate", message: LEAVE_MESSAGES.tooLong };
  const fp = input.fromPeriod ?? null;
  const tp = input.toPeriod ?? null;
  if (fp !== null || tp !== null) {
    if (fp === null) return { field: "fromPeriod", message: LEAVE_MESSAGES.periodsPair };
    if (tp === null) return { field: "toPeriod", message: LEAVE_MESSAGES.periodsPair };
    if (!Number.isInteger(fp) || fp < 1 || fp > LEAVE_MAX_PERIOD) return { field: "fromPeriod", message: LEAVE_MESSAGES.periodUnknown };
    if (!Number.isInteger(tp) || tp < 1 || tp > LEAVE_MAX_PERIOD) return { field: "toPeriod", message: LEAVE_MESSAGES.periodUnknown };
    if (fromDate !== toDate) return { field: "fromPeriod", message: LEAVE_MESSAGES.periodsOneDay };
    if (tp < fp) return { field: "toPeriod", message: LEAVE_MESSAGES.periodsOrder };
  }
  return null;
}

/** Inclusive number of calendar days of `[from, to]`. */
export function leaveDays(fromDate: string, toDate: string): number {
  return daysBetweenIso(fromDate, toDate) + 1;
}

/** The facts of a leave that decide what it covers. */
export interface LeaveSpan {
  fromDate: string;
  toDate: string;
  fromPeriod: number | null;
  toPeriod: number | null;
}

/**
 * Do two leaves of the SAME child overlap? Their date ranges must meet; two partial days (single-day, with periods)
 * overlap only when their period ranges do — «زنگ ۱ تا ۳» and «زنگ ۴ تا ۶» of one day sit side by side. A leave of
 * whole days overlaps anything it meets.
 */
export function leavesOverlap(a: LeaveSpan, b: LeaveSpan): boolean {
  if (a.toDate < b.fromDate || b.toDate < a.fromDate) return false;
  const aPartial = a.fromPeriod !== null && a.toPeriod !== null;
  const bPartial = b.fromPeriod !== null && b.toPeriod !== null;
  if (!aPartial || !bPartial) return true;
  return a.fromPeriod! <= b.toPeriod! && b.fromPeriod! <= a.toPeriod!;
}

/**
 * Does an APPROVED leave cover this roll call? A whole-day leave covers every roll call of its dates, the daily one
 * (`periodNo` null) included; a partial day covers exactly its زنگ‌ها and never the daily roll call.
 */
export function leaveCovers(leave: LeaveSpan, date: string, periodNo: number | null): boolean {
  if (date < leave.fromDate || date > leave.toDate) return false;
  if (leave.fromPeriod === null || leave.toPeriod === null) return true;
  return periodNo !== null && periodNo >= leave.fromPeriod && periodNo <= leave.toPeriod;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

/** `HH:MM[:SS]` (ASCII digits) → `HH:MM`, or null when it is not a clock time. */
export function normalizeClock(value: string): string | null {
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** Tehran wall-clock time (`HH:MM`) of an instant — the default of a «خروج مجاز» recorded right now. */
export function tehranClock(now = new Date()): string {
  const minutes = (((Math.floor(now.getTime() / 60_000) + 3 * 60 + 30) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Does an early exit at `exitTime` cover the زنگ that starts at `periodStartsAt`? The student left before it began:
 * every زنگ that starts at or after the exit is excused; the one in progress is not (they sat part of it).
 * The daily roll call (no زنگ) is never covered — the student was there in the morning.
 */
export function earlyExitCovers(exitTime: string, periodStartsAt: string): boolean {
  const exit = normalizeClock(exitTime);
  const start = normalizeClock(periodStartsAt);
  if (exit === null || start === null) return false;
  return start >= exit;
}

/** The plain «N روز» length phrase. */
export function leaveLengthFa(fromDate: string, toDate: string): string {
  const n = leaveDays(fromDate, toDate);
  return n === 1 ? "یک روز" : `${formatNumberFa(n)} روز`;
}

/**
 * One line for a leave's span: «۱۴۰۵/۰۷/۰۱ تا ۱۴۰۵/۰۷/۰۳ · ۳ روز», or for a partial day «۱۴۰۵/۰۷/۰۱ · زنگ ۲ تا ۴»
 * (a single زنگ reads «زنگ ۲»).
 */
export function leaveSpanFa(l: LeaveSpan): string {
  if (l.fromPeriod !== null && l.toPeriod !== null) {
    const periods = l.fromPeriod === l.toPeriod ? `زنگ ${formatNumberFa(l.fromPeriod)}` : `زنگ ${formatNumberFa(l.fromPeriod)} تا ${formatNumberFa(l.toPeriod)}`;
    return `${isoDateToJalali(l.fromDate)} · ${periods}`;
  }
  if (l.fromDate === l.toDate) return `${isoDateToJalali(l.fromDate)} · یک روز`;
  return `${isoDateToJalali(l.fromDate)} تا ${isoDateToJalali(l.toDate)} · ${leaveLengthFa(l.fromDate, l.toDate)}`;
}

/** Trims, collapses nothing else; empty → null. Callers normalize digits / letters (`normalizeFa`) and slice to the bound. */
export function cleanOptionalText(value: string | null | undefined, max: number): string | null {
  const t = (value ?? "").trim();
  return t === "" ? null : t.slice(0, max);
}

/** Notification title of a new request (title only — a note, a category or a date never reaches a bell). */
export function leaveRequestedTitle(childName: string): string {
  return `درخواست مرخصی: ${childName}`;
}

/** What covers a roll call beforehand (`src/modules/academic/leave-coverage.ts`): an approved leave or an authorized early exit. */
export type CoverageKind = "leave" | "early_exit";

/** The tag a covered student wears on the roll-call page. */
export const COVERAGE_LABELS: Record<CoverageKind, string> = {
  leave: "مرخصی",
  early_exit: "خروج مجاز",
};
