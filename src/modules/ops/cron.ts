// ops/cron — the scheduler's clock: five-field cron expressions («minute hour day-of-month month day-of-week»),
// minute resolution, evaluated in a time zone (Asia/Tehran by default) through the platform's tz database (`Intl`).
// Pure — no I/O, no Date.now(): every function takes the instant it reasons about.
//
// Fields: `*`, a number, `a-b`, `*/n`, `a-b/n`, and comma lists of those. Day of week 0–7 (0 and 7 = Sunday — the
// cron convention, not the Iranian week; «شنبه» is 6). When BOTH day fields are restricted a day matches when EITHER
// does (Vixie cron); otherwise both must. No names (`MON`, `JAN`), no `@daily`, no seconds — a schedule is code, so
// the expression is checked when the worker starts (src/lib/jobs/scheduler.ts) and by tests.
//
// Asia/Tehran has kept UTC+03:30 all year since 2022 (Iran abolished daylight saving time); the implementation does
// not assume that — local fields come from Intl for every candidate minute, so a zone with DST works too (a local
// time that does not exist is skipped, a repeated one fires once).

export const DEFAULT_TIME_ZONE = "Asia/Tehran";

export interface CronSpec {
  source: string;
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  /** 0 = Sunday … 6 = Saturday (a 7 in the expression is folded into 0). */
  daysOfWeek: ReadonlySet<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
] as const;

function parseField(raw: string, field: (typeof FIELDS)[number]): { values: Set<number>; restricted: boolean } {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const m = /^(\*|(\d{1,2})(?:-(\d{1,2}))?)(?:\/(\d{1,2}))?$/.exec(part);
    if (!m) throw new Error(`cron: bad ${field.name} field "${raw}"`);
    const step = m[4] === undefined ? 1 : Number(m[4]);
    let lo: number;
    let hi: number;
    if (m[1] === "*") {
      lo = field.min;
      hi = field.max;
    } else {
      lo = Number(m[2]);
      // `5/15` = from 5 to the end in steps of 15 (Vixie); a bare `5` is just 5.
      hi = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? field.max : lo;
    }
    if (step < 1 || lo < field.min || hi > field.max || lo > hi) throw new Error(`cron: ${field.name} out of range in "${raw}"`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, restricted: raw !== "*" };
}

/** Throws on anything that is not a valid five-field expression. */
export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== FIELDS.length) throw new Error(`cron: expected 5 fields, got ${parts.length} in "${expr}"`);
  const [mi, h, dom, mo, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  const daysOfWeek = new Set([...dow.values].map((d) => (d === 7 ? 0 : d)));
  return {
    source: parts.join(" "),
    minutes: mi.values,
    hours: h.values,
    daysOfMonth: dom.values,
    months: mo.values,
    daysOfWeek,
    domRestricted: dom.restricted,
    dowRestricted: dow.restricted,
  };
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock fields of `at` in `timeZone`. */
export function localParts(at: Date, timeZone: string = DEFAULT_TIME_ZONE): LocalParts {
  const out: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(at)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    weekday: WEEKDAYS[out.weekday] ?? -1,
  };
}

function dayMatches(spec: CronSpec, p: LocalParts): boolean {
  const dom = spec.daysOfMonth.has(p.day);
  const dow = spec.daysOfWeek.has(p.weekday);
  if (spec.domRestricted && spec.dowRestricted) return dom || dow;
  return dom && dow;
}

/** Does `spec` fire in the minute that contains `at`? */
export function cronMatches(spec: CronSpec, at: Date, timeZone: string = DEFAULT_TIME_ZONE): boolean {
  const p = localParts(at, timeZone);
  return spec.months.has(p.month) && dayMatches(spec, p) && spec.hours.has(p.hour) && spec.minutes.has(p.minute);
}

const MINUTE = 60_000;
/** Enough for `0 0 29 2 *` (a leap day can be eight years away) at one step per local day. */
const MAX_STEPS = 200_000;

/** The first instant STRICTLY after `after` (at a whole minute) at which `spec` fires in `timeZone`. */
export function nextFire(spec: CronSpec, after: Date, timeZone: string = DEFAULT_TIME_ZONE): Date {
  let t = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE;
  for (let step = 0; step < MAX_STEPS; step++) {
    const p = localParts(new Date(t), timeZone);
    if (!spec.months.has(p.month) || !dayMatches(spec, p)) {
      // To the next local midnight (a DST day may land an hour off; the hour test below corrects it).
      t += (24 * 60 - (p.hour * 60 + p.minute)) * MINUTE;
      continue;
    }
    if (!spec.hours.has(p.hour)) {
      t += (60 - p.minute) * MINUTE;
      continue;
    }
    if (!spec.minutes.has(p.minute)) {
      t += MINUTE;
      continue;
    }
    return new Date(t);
  }
  throw new Error(`cron: "${spec.source}" never fires`);
}
