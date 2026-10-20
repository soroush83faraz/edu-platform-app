// config/settings — the registry of school settings («تنظیمات»; owner 2026-10-20, docs/decisions.md «صف، زمان‌بند و
// Feature Flag»). Pure. Each key: its Persian label, its kind (a whole number in a range with a unit, or a daily time
// range), its default, whether a school may override it. config.setting_value holds only what an admin SET (jsonb;
// school_id NULL = the organization); a stored value that no longer validates — the range narrowed in a release — is
// ignored and the next level applies, so a reader always gets a value of the registered shape.
//
// Precedence (`resolveSetting`): a school's value (when overridable) > the organization's > the default.
import { z } from "zod";
import { toAsciiDigits } from "@/lib/normalize";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TimeRange = z.object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) }).strict();
export type TimeRangeValue = z.infer<typeof TimeRange>;

interface BaseDef {
  labelFa: string;
  descriptionFa: string;
  schoolOverridable: boolean;
  /** The feature that reads it is not built yet (the page marks it «به‌زودی»). */
  upcoming?: boolean;
}

export interface IntSettingDef extends BaseDef {
  kind: "int";
  min: number;
  max: number;
  unitFa: string;
  default: number;
}

export interface TimeRangeSettingDef extends BaseDef {
  kind: "time_range";
  default: TimeRangeValue;
}

export type SettingDef = IntSettingDef | TimeRangeSettingDef;

export const SETTINGS = {
  "grades.appeal_window_days": {
    kind: "int",
    labelFa: "مهلت اعتراض به نمره",
    descriptionFa: "از زمان اعلام نمره، چند روز برای ثبت اعتراض فرصت هست.",
    min: 1,
    max: 30,
    unitFa: "روز",
    default: 7, // owner decision, 2026-10-20
    schoolOverridable: true,
    upcoming: true,
  },
  "grades.appeal_response_days": {
    kind: "int",
    labelFa: "مهلت پاسخ دبیر به اعتراض",
    descriptionFa: "دبیر تا چند روز پس از ثبت اعتراض باید پاسخ دهد.",
    min: 1,
    max: 14,
    unitFa: "روز",
    default: 2,
    schoolOverridable: true,
    upcoming: true,
  },
  "notif.quiet_hours": {
    kind: "time_range",
    labelFa: "ساعت‌های سکوت اعلان",
    descriptionFa: "در این بازه یادآوری و اعلان خودکار فرستاده نمی‌شود و به پس از آن می‌افتد.",
    default: { start: "22:00", end: "07:00" },
    schoolOverridable: true,
    upcoming: true,
  },
  "reminders.deadline_lead_hours": {
    kind: "int",
    labelFa: "یادآوری پیش از مهلت تکلیف",
    descriptionFa: "چند ساعت پیش از پایان مهلت، به دانش‌آموزی که تکلیف را انجام نداده یادآوری شود.",
    min: 1,
    max: 168,
    unitFa: "ساعت",
    default: 24,
    schoolOverridable: true,
    upcoming: true,
  },
  "requests.sla_hours.admin_request": {
    kind: "int",
    labelFa: "مهلت رسیدگی به درخواست از مدیریت",
    descriptionFa: "اگر درخواستی در این مدت پاسخ نگیرد، به مدیر مدرسه ارجاع می‌شود.",
    min: 1,
    max: 720,
    unitFa: "ساعت",
    default: 72,
    schoolOverridable: true,
    upcoming: true,
  },
  "requests.sla_hours.parent_message": {
    kind: "int",
    labelFa: "مهلت پاسخ به پیام اولیا",
    descriptionFa: "اگر پیام ولی در این مدت پاسخ نگیرد، به مدیر مدرسه ارجاع می‌شود.",
    min: 1,
    max: 720,
    unitFa: "ساعت",
    default: 48,
    schoolOverridable: true,
    upcoming: true,
  },
  "requests.sla_hours.leave_request": {
    kind: "int",
    labelFa: "مهلت رسیدگی به درخواست مرخصی",
    descriptionFa: "اگر درخواست مرخصی در این مدت پاسخ نگیرد، به مدیر مدرسه ارجاع می‌شود.",
    min: 1,
    max: 720,
    unitFa: "ساعت",
    default: 24,
    schoolOverridable: true,
    upcoming: true,
  },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

type DefOf<K extends SettingKey> = (typeof SETTINGS)[K];
export type SettingValue<K extends SettingKey> = DefOf<K> extends { kind: "int" } ? number : TimeRangeValue;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

/** The value schema of a key (a range-checked integer, or a time range). */
export function settingSchema(key: SettingKey): z.ZodType<number | TimeRangeValue> {
  const def: SettingDef = SETTINGS[key];
  return def.kind === "int" ? z.number().int().min(def.min).max(def.max) : TimeRange;
}

export interface SettingRow {
  key: string;
  schoolId: string | null;
  value: unknown;
}

export type SettingSource = "default" | "organization" | "school";

export interface ResolvedSetting<K extends SettingKey> {
  value: SettingValue<K>;
  source: SettingSource;
}

/** school value (if overridable and valid) > organization value (if valid) > default. */
export function resolveSetting<K extends SettingKey>(rows: readonly SettingRow[], key: K, schoolId?: string | null): ResolvedSetting<K> {
  const def: SettingDef = SETTINGS[key];
  const schema = settingSchema(key);
  const pick = (row: SettingRow | undefined) => (row ? schema.safeParse(row.value) : null);
  if (schoolId && def.schoolOverridable) {
    const s = pick(rows.find((r) => r.key === key && r.schoolId === schoolId));
    if (s?.success) return { value: s.data as SettingValue<K>, source: "school" };
  }
  const o = pick(rows.find((r) => r.key === key && r.schoolId === null));
  if (o?.success) return { value: o.data as SettingValue<K>, source: "organization" };
  return { value: def.default as SettingValue<K>, source: "default" };
}

/** The value of a form's fields for a key (`value`, or `start` + `end`), validated; null = invalid. */
export function parseSettingInput(key: SettingKey, raw: { value?: string; start?: string; end?: string }): number | TimeRangeValue | null {
  const def: SettingDef = SETTINGS[key];
  const toLatin = (s: string) => toAsciiDigits(s).trim();
  const candidate = def.kind === "int" ? (/^\d{1,6}$/.test(toLatin(raw.value ?? "")) ? Number(toLatin(raw.value ?? "")) : NaN) : { start: toLatin(raw.start ?? ""), end: toLatin(raw.end ?? "") };
  const parsed = settingSchema(key).safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
