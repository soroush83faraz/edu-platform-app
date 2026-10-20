// workspace/request-sla — the rules of «مرکز درخواست‌ها» (flag `request_center`; owner 2026-10-20, docs/decisions.md
// «یادآوری مهلت و مرکز درخواست‌ها»). Pure: the request kinds, the response-time math, the escalation chain. Unit-tested
// in tests/unit/request-sla.test.ts; ./requests.ts holds the reads and writes.
//
// A REQUEST is something addressed to the school that waits for ONE answer: a counselor's «ارجاع به مدیریت»
// (`admin_request`), a guardian's «پیام به مدرسه» (`parent_message`) — and, once it is built, a guardian's «درخواست
// مرخصی» (`leave_request`, academic.leave_request: it plugs in by kind — a row of `workspace.request_sla` written when
// it is filed, and its own addressee reader; nothing here changes). Each kind has a response time (settings
// `requests.sla_hours.<kind>`: 72 / 48 / 24 h). A request's clock runs in PERIODS: the first starts when it is sent;
// at 80 % of a period its addressees are reminded once; at the end of it the request is ESCALATED — the next level of
// the chain is ADDED as addressees (the earlier ones stay) — and a new period of the same length starts for them.
//
// The chain, by the highest office an addressee holds AT the request's school:
//   staff (a دبیر, a مشاور, anyone else) → معاون → مدیر مدرسه → مدیر سازمان.
// A level nobody holds is skipped (a school with no vice principal goes from a دبیر straight to the principal); past
// the organization admin there is nobody — the request keeps its addressees and a new period starts (they are
// reminded again at its 80 %).

export const REQUEST_KINDS = {
  admin_request: { labelFa: "ارجاع مشاور", settingKey: "requests.sla_hours.admin_request", workItemType: "admin_request" },
  parent_message: { labelFa: "پیام ولی", settingKey: "requests.sla_hours.parent_message", workItemType: "parent_message" },
  /** Not wired yet: the leave requests are built separately (academic.leave_request) and plug in here by kind. */
  leave_request: { labelFa: "درخواست مرخصی", settingKey: "requests.sla_hours.leave_request", workItemType: null },
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
  dueAt: Date;
  warnedAt: Date | null;
}

/** The 80 % mark of the current period. */
export function warnAt(c: Pick<SlaClock, "periodStartedAt" | "dueAt">): Date {
  const start = c.periodStartedAt.getTime();
  return new Date(start + Math.round((c.dueAt.getTime() - start) * WARN_FRACTION));
}

export type SlaStatus = "on_time" | "near" | "overdue";

export const SLA_STATUS_FA: Record<SlaStatus, string> = { on_time: "در مهلت", near: "نزدیک مهلت", overdue: "گذشته" };

/** در مهلت → نزدیک مهلت (from the 80 % mark) → گذشته (the period is over). */
export function slaStatus(c: Pick<SlaClock, "periodStartedAt" | "dueAt">, now: Date): SlaStatus {
  if (now.getTime() >= c.dueAt.getTime()) return "overdue";
  return now.getTime() >= warnAt(c).getTime() ? "near" : "on_time";
}

export type SlaAction = "none" | "warn" | "escalate";

/** What a check at `now` does: escalate a finished period, remind once at its 80 %, else nothing. */
export function slaAction(c: SlaClock, now: Date): SlaAction {
  const status = slaStatus(c, now);
  if (status === "overdue") return "escalate";
  if (status === "near" && (c.warnedAt === null || c.warnedAt.getTime() < c.periodStartedAt.getTime())) return "warn";
  return "none";
}

/** A new period of `hours` from `now`. */
export function nextPeriod(now: Date, hours: number): { periodStartedAt: Date; dueAt: Date } {
  return { periodStartedAt: now, dueAt: new Date(now.getTime() + hours * HOUR) };
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
 * The level an escalation adds: the lowest one above `current` that has a candidate who is not an addressee yet;
 * null past the organization admin or when nobody is left to add.
 */
export function nextLevel(current: number, candidates: Readonly<Record<Exclude<Level, "staff">, readonly string[]>>, addressees: ReadonlySet<string>): { level: Exclude<Level, "staff">; personIds: string[] } | null {
  for (const level of ["vice_principal", "principal", "org_admin"] as const) {
    if (LEVEL_INDEX[level] <= current) continue;
    const add = candidates[level].filter((id) => !addressees.has(id));
    if (add.length > 0) return { level, personIds: add };
  }
  return null;
}
