// config/flags — the registry of feature switches («قابلیت‌ها»; owner 2026-10-20, docs/decisions.md «صف، زمان‌بند و
// Feature Flag»). Pure. A key exists only here: its Persian label and description, its default, and whether a school may
// override the organization's value. config.feature_flag holds only what an admin SET (school_id NULL = the
// organization); a key that is not in this registry is ignored wherever it appears.
//
// Precedence (`resolveFlag`): a school's row (when the key is school-overridable) > the organization's row > the
// default. Every key for a feature that is not built yet defaults to OFF and carries `upcoming` — the settings page
// marks it «به‌زودی»; turning it on before the feature ships changes nothing until the feature reads it.

export interface FlagDef {
  labelFa: string;
  descriptionFa: string;
  default: boolean;
  /** A school's principal may turn it on / off for their school. */
  schoolOverridable: boolean;
  /** The feature it guards is not built yet. */
  upcoming?: boolean;
}

export const FEATURE_FLAGS = {
  messaging: {
    labelFa: "پیام‌رسانی",
    descriptionFa: "گفت‌وگوی دبیر، دانش‌آموز و اولیا درون برنامه.",
    default: false,
    schoolOverridable: true,
    upcoming: true,
  },
  grades_monthly: {
    labelFa: "نمره‌های ماهانه",
    descriptionFa: "ثبت نمرهٴ ماهانهٴ هر درس به دست دبیر و دیدن آن برای دانش‌آموز و ولی.",
    default: false,
    schoolOverridable: true,
    upcoming: true,
  },
  grade_appeals: {
    labelFa: "اعتراض به نمره",
    descriptionFa: "دانش‌آموز یا ولی در مهلت مقرر به نمره اعتراض می‌کند و دبیر پاسخ می‌دهد.",
    default: false,
    schoolOverridable: true,
    upcoming: true,
  },
  // Built (2026-10-20) and ON by default (security review F5: a switch must be read where its feature lives):
  // «درخواست مرخصی» — off, a school's guardians file no new request (the form and its Home door go; what was already
  // asked is still decided, and keeps its response clock); «دفتر کلاسی» — off, no «گزارش جلسه» card, log or write.
  leave_requests: {
    labelFa: "درخواست مرخصی",
    descriptionFa: "درخواست مرخصی دانش‌آموز از سوی ولی و رسیدگی مدرسه به آن.",
    default: true,
    schoolOverridable: true,
  },
  class_register: {
    labelFa: "دفتر کلاسی",
    descriptionFa: "ثبت روزانهٴ هر زنگ: موضوع درس، تکلیف و یادداشت دبیر.",
    default: true,
    schoolOverridable: true,
  },
  deadline_reminders: {
    labelFa: "یادآوری مهلت تکالیف",
    descriptionFa: "اعلان به کسی که تکلیف را هنوز انجام نداده، پیش از پایان مهلت؛ و به دهندهٴ آن وقتی مهلت بگذرد و کسانی تمامش نکرده باشند.",
    default: false,
    schoolOverridable: true,
  },
  request_center: {
    labelFa: "مرکز درخواست‌ها",
    descriptionFa: "پیگیری ارجاع‌های مشاور و پیام‌های اولیا با مهلت پاسخ: یادآوری نزدیک مهلت و ارجاع خودکار به سطح بالاتر وقتی مهلت بگذرد.",
    default: false,
    schoolOverridable: false,
  },
} as const satisfies Record<string, FlagDef>;

export type FlagKey = keyof typeof FEATURE_FLAGS;
export const FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FlagKey[];

export function isFlagKey(key: string): key is FlagKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, key);
}

export interface FlagRow {
  key: string;
  schoolId: string | null;
  enabled: boolean;
}

export type FlagSource = "default" | "organization" | "school";

export interface ResolvedFlag {
  enabled: boolean;
  source: FlagSource;
}

/** school row (if overridable) > organization row > default. */
export function resolveFlag(rows: readonly FlagRow[], key: FlagKey, schoolId?: string | null): ResolvedFlag {
  const def: FlagDef = FEATURE_FLAGS[key];
  if (schoolId && def.schoolOverridable) {
    const school = rows.find((r) => r.key === key && r.schoolId === schoolId);
    if (school) return { enabled: school.enabled, source: "school" };
  }
  const org = rows.find((r) => r.key === key && r.schoolId === null);
  if (org) return { enabled: org.enabled, source: "organization" };
  return { enabled: def.default, source: "default" };
}
