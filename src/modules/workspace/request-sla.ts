// workspace/request-sla — the rules of «مرکز درخواست‌ها» (flag `request_center`; owner 2026-10-20, docs/decisions.md
// «یادآوری مهلت و مرکز درخواست‌ها»). Pure: the request kinds, the response-time math, the escalation chain. Unit-tested
// in tests/unit/request-sla.test.ts; ./requests.ts holds the reads and writes.
//
// A REQUEST is something addressed to the school that waits for ONE answer: a counselor's «ارجاع به مدیریت»
// (`admin_request`), a guardian's «پیام به مدرسه» (`parent_message`) — both carried by a work item — and a guardian's
// «درخواست مرخصی» (`leave_request`, academic.leave_request, migration 0030: no work item; its addressees are read from
// the school's offices, ./requests). Each kind has a response time (settings `requests.sla_hours.<kind>`: 72 / 48 / 24
// h). A request's clock runs in PERIODS: the first starts when it is sent; at 80 % of a period its addressees are
// reminded once; at the end of it the request is ESCALATED — the next level of the chain is ADDED as addressees (the
// earlier ones stay) — and a new period of the same length starts for them.
//
// The chain, by the highest office an addressee holds AT the request's school:
//   staff (a دبیر, a مشاور, anyone else) → معاون → مدیر مدرسه → مدیر سازمان,
// up to the kind's TOP level (owner, 2026-10-20): a counselor's referral goes up to the organization admin; what a
// GUARDIAN wrote — a message, a leave request — never leaves the school: its chain stops at the principal. A level
// nobody holds is skipped (a school with no vice principal goes from a دبیر straight to the principal); past the top
// there is nobody — the request keeps its addressees and a new period starts (they are reminded again at its 80 %).
//
// «در حال بررسی» STOPS the clock (owner, 2026-10-20): while the request is in progress nothing is counted — no
// reminder, no escalation; back to «باز», the time it was paused is added to the deadline (`due_at`) and to the
// period's `pausedSeconds`, so the 80 % mark and the deadline measure ACTIVE time only. A leave request has no
// «در حال بررسی»: its clock never pauses.

export const REQUEST_KINDS = {
  admin_request: { labelFa: "ارجاع مشاور", settingKey: "requests.sla_hours.admin_request", workItemType: "admin_request", topLevel: "org_admin" },
  /** A guardian's words stay in the school: up to the principal, never the organization admin (owner, 2026-10-20). */
  parent_message: { labelFa: "پیام ولی", settingKey: "requests.sla_hours.parent_message", workItemType: "parent_message", topLevel: "principal" },
  /** academic.leave_request (0029/0030): the school's vice principals first, then its principal — never further. */
  leave_request: { labelFa: "درخواست مرخصی", settingKey: "requests.sla_hours.leave_request", workItemType: null, topLevel: "principal" },
} as const;

export type RequestKind = keyof typeof REQUEST_KINDS;
export const REQUEST_KIND_CODES = Object.keys(REQUEST_KINDS) as RequestKind[];
/** The kinds carried by a work item (their addressees are its `assignee` rows). */
export type WorkItemRequestKind = { [K in RequestKind]: (typeof REQUEST_KINDS)[K]["workItemType"] extends null ? never : K }[RequestKind];

export function isRequestKind(v: string): v is RequestKind {
  return Object.prototype.hasOwnProperty.call(REQUEST_KINDS, v);
}

/** The placeholder a manager reads for a confidential request they are no participant of. */
export const CONFIDENTIAL_REQUEST_TITLE = "درخواست محرمانه";

/** The share of a period after which the addressees are reminded. */
export const WARN_FRACTION = 0.8;
const HOUR = 3_600_000;

export interface SlaClock {
  periodStartedAt: Date;
  /** The deadline of the current period — moved on by every pause the period has had (`pausedSeconds`). */
  dueAt: Date;
  warnedAt: Date | null;
  /** Seconds this period spent «در حال بررسی», already added to `dueAt` (0 when omitted). */
  pausedSeconds?: number;
  /** «در حال بررسی» since then: the clock is stopped (null / omitted = running). */
  pausedAt?: Date | null;
}

type ClockSpan = Pick<SlaClock, "periodStartedAt" | "dueAt" | "pausedSeconds">;

/** The ACTIVE length of the current period (ms): from its start to its deadline, minus the time it was paused. */
export function activeLength(c: ClockSpan): number {
  return c.dueAt.getTime() - c.periodStartedAt.getTime() - (c.pausedSeconds ?? 0) * 1000;
}

/** The 80 % mark of the current period: 80 % of its active time after its start, the paused time added. */
export function warnAt(c: ClockSpan): Date {
  return new Date(c.dueAt.getTime() - Math.round(activeLength(c) * (1 - WARN_FRACTION)));
}

export type SlaStatus = "on_time" | "near" | "overdue";

export const SLA_STATUS_FA: Record<SlaStatus, string> = { on_time: "در مهلت", near: "نزدیک مهلت", overdue: "گذشته" };

/**
 * در مهلت → نزدیک مهلت (from the 80 % mark) → گذشته (the period is over). A paused clock reads as it stood when it
 * stopped — the time since does not count.
 */
export function slaStatus(c: ClockSpan & Pick<SlaClock, "pausedAt">, now: Date): SlaStatus {
  const t = c.pausedAt ? Math.min(now.getTime(), c.pausedAt.getTime()) : now.getTime();
  if (t >= c.dueAt.getTime()) return "overdue";
  return t >= warnAt(c).getTime() ? "near" : "on_time";
}

export type SlaAction = "none" | "warn" | "escalate";

/** What a check at `now` does: nothing while paused; escalate a finished period, remind once at its 80 %, else nothing. */
export function slaAction(c: SlaClock, now: Date): SlaAction {
  if (c.pausedAt) return "none";
  const status = slaStatus(c, now);
  if (status === "overdue") return "escalate";
  if (status === "near" && (c.warnedAt === null || c.warnedAt.getTime() < c.periodStartedAt.getTime())) return "warn";
  return "none";
}

/** A new period of `hours` from `now` (never paused: nothing escalates while «در حال بررسی»). */
export function nextPeriod(now: Date, hours: number): { periodStartedAt: Date; dueAt: Date; pausedSeconds: 0; pausedAt: null } {
  return { periodStartedAt: now, dueAt: new Date(now.getTime() + hours * HOUR), pausedSeconds: 0, pausedAt: null };
}

/**
 * Back to «باز» at `now` after a pause that began at `pausedAt`: the whole seconds it lasted (never negative) — what
 * `due_at` moves on by and `paused_seconds` grows by (the SQL of ./request-clock does the same).
 */
export function resumeShiftSeconds(pausedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - pausedAt.getTime()) / 1000));
}

/**
 * What a status change does to the request's clock, by the item's NEW status category: «در حال بررسی» stops it,
 * «باز» runs it again, an answer or a cancellation closes it.
 */
export function clockOnStatus(category: string): "pause" | "resume" | "close" | "none" {
  if (category === "doing") return "pause";
  if (category === "todo") return "resume";
  if (category === "done" || category === "cancelled") return "close";
  return "none";
}

/** The levels of the chain, lowest first. */
export const LEVELS = ["staff", "vice_principal", "principal", "org_admin"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_INDEX: Record<Level, number> = { staff: 0, vice_principal: 1, principal: 2, org_admin: 3 };

/** The SYSTEM role that makes a person a level of the chain (at the school; `org_admin` at the organization). */
export const LEVEL_ROLE: Record<Exclude<Level, "staff">, string> = { vice_principal: "vice_principal", principal: "school_principal", org_admin: "org_admin" };

/** A person's level from the chain roles they hold (already narrowed to the school / the organization). */
export function levelOf(roleCodes: readonly string[]): Level {
  if (roleCodes.includes("org_admin")) return "org_admin";
  if (roleCodes.includes("school_principal")) return "principal";
  if (roleCodes.includes("vice_principal")) return "vice_principal";
  return "staff";
}

/** The highest level among the live addressees; -1 when none is left. */
export function currentLevel(levels: readonly Level[]): number {
  return levels.reduce((max, l) => Math.max(max, LEVEL_INDEX[l]), -1);
}

/**
 * The level an escalation adds: the lowest one above `current` — and not above the kind's `top` — that has a
 * candidate who is not an addressee yet; null past the top (the organization admin by default) or when nobody is left.
 */
export function nextLevel(
  current: number,
  candidates: Readonly<Record<Exclude<Level, "staff">, readonly string[]>>,
  addressees: ReadonlySet<string>,
  top: Exclude<Level, "staff"> = "org_admin",
): { level: Exclude<Level, "staff">; personIds: string[] } | null {
  for (const level of ["vice_principal", "principal", "org_admin"] as const) {
    if (LEVEL_INDEX[level] <= current) continue;
    if (LEVEL_INDEX[level] > LEVEL_INDEX[top]) break;
    const add = candidates[level].filter((id) => !addressees.has(id));
    if (add.length > 0) return { level, personIds: add };
  }
  return null;
}
