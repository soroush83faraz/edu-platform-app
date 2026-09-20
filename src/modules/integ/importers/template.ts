// The Excel template (v1) — the single description of sheets and columns shared by the builder
// (scripts/build-template.ts), the parser (header → key mapping) and the validator (required columns).
// Row 1 = Persian headers (what the school sees), hidden row 2 = English keys (what the parser reads).
// `aliases` accept the wording of the v0 client document (docs/client/02-ghaleb-excel-v0.md) so a file
// filled from that description still parses.

export type SheetKey = "classes" | "students" | "staff" | "teaching";

export interface ColumnDef {
  key: string;
  labelFa: string;
  required: boolean;
  /** Extra Persian headers accepted for this column. */
  aliases?: string[];
  /** Phone column: text format in the template, `normalizePhoneIR` in the parser. */
  phone?: boolean;
  /** Digits → ASCII (student numbers, employee numbers). */
  digits?: boolean;
  /** Column width in characters. */
  width?: number;
  /** A required column may be absent when one of these keys is present (v0 files name the teacher instead of the phone). */
  requiredUnless?: string[];
  /** Accepted by the parser but not part of the generated template (v0 compatibility). */
  templateHidden?: boolean;
  hintFa: string;
  example: string[];
}

export interface SheetDef {
  key: SheetKey;
  nameFa: string;
  /** Other sheet names accepted by the parser. */
  aliases?: string[];
  descriptionFa: string;
  columns: ColumnDef[];
}

export const TEMPLATE_VERSION = "v1";

export const SHEETS: SheetDef[] = [
  {
    key: "classes",
    nameFa: "کلاس‌ها",
    descriptionFa: "هر ردیف یک کلاس. نام کلاس در یک سال تحصیلی و شعبه یکتا است. اگر کلاس از قبل در سامانه هست، همان به‌روز می‌شود.",
    columns: [
      { key: "grade", labelFa: "پایه", required: true, width: 14, hintFa: "نام یا کد پایه، دقیقاً مثل سامانه (دهم، یازدهم، …)", example: ["دهم", "دهم", "یازدهم"] },
      { key: "class_name", labelFa: "نام کلاس", required: true, aliases: ["کلاس"], width: 14, hintFa: "مثلاً ۱۰/۱ یا الف", example: ["۱۰/۱", "۱۰/۲", "۱۱/۱"] },
      { key: "branch", labelFa: "شعبه", required: false, width: 14, hintFa: "خالی = شعبهٴ پیش‌فرض (مرکزی)", example: ["", "", ""] },
    ],
  },
  {
    key: "students",
    nameFa: "دانش‌آموزان",
    descriptionFa: "هر ردیف یک دانش‌آموز. شمارهٴ دانش‌آموزی در سازمان یکتا است و کلید به‌روزرسانی است. بدون موبایل، نام‌کاربری = کد مدرسه-شمارهٴ دانش‌آموزی.",
    columns: [
      { key: "first_name", labelFa: "نام", required: true, width: 16, hintFa: "", example: ["سارا", "علی", "مریم"] },
      { key: "last_name", labelFa: "نام خانوادگی", required: true, width: 18, hintFa: "", example: ["کریمی", "رضایی", "احمدی"] },
      { key: "student_number", labelFa: "شمارهٴ دانش‌آموزی", required: true, aliases: ["شماره دانش‌آموزی", "شماره دانش آموزی", "شمارهٴ دانش آموزی"], digits: true, width: 18, hintFa: "رقم، حرف انگلیسی و خط تیره؛ حداکثر ۲۰ نویسه", example: ["1001", "1002", "1003"] },
      { key: "phone", labelFa: "موبایل دانش‌آموز", required: false, aliases: ["شمارهٴ موبایل", "شماره موبایل", "موبایل"], phone: true, width: 16, hintFa: "اختیاری؛ با صفر اول، مثل ۰۹۱۲۱۲۳۴۵۶۷", example: ["09121234567", "", "09198877665"] },
      { key: "guardian_phone", labelFa: "شمارهٴ ولی", required: false, aliases: ["شماره ولی", "موبایل ولی"], phone: true, width: 16, hintFa: "اختیاری؛ جدا از شمارهٴ خود دانش‌آموز", example: ["09127654321", "09131112233", ""] },
      { key: "grade", labelFa: "پایه", required: true, width: 12, hintFa: "همان پایهٴ کلاس", example: ["دهم", "دهم", "دهم"] },
      { key: "class_name", labelFa: "کلاس", required: true, aliases: ["نام کلاس"], width: 12, hintFa: "دقیقاً همان نام در شیت کلاس‌ها", example: ["۱۰/۱", "۱۰/۲", "۱۰/۱"] },
      { key: "external_ref", labelFa: "کد یکتا", required: false, aliases: ["کد یکتای سامانهٴ قبلی", "کد"], width: 14, hintFa: "اختیاری؛ شناسهٴ سامانهٴ قبلی", example: ["", "", ""] },
    ],
  },
  {
    key: "staff",
    nameFa: "دبیران",
    aliases: ["کارکنان", "معلمان"],
    descriptionFa: "هر ردیف یک دبیر یا همکار. موبایل الزامی و کلید یکتا است (شناسهٴ ورود). دبیری که از قبل هست، دوباره ساخته نمی‌شود.",
    columns: [
      { key: "first_name", labelFa: "نام", required: true, width: 16, hintFa: "", example: ["حسین", "زهرا", "رضا"] },
      { key: "last_name", labelFa: "نام خانوادگی", required: true, width: 18, hintFa: "", example: ["محمدی", "حسینی", "نوری"] },
      { key: "phone", labelFa: "موبایل", required: true, aliases: ["شمارهٴ موبایل", "شماره موبایل"], phone: true, width: 16, hintFa: "با صفر اول، مثل ۰۹۱۲۱۲۳۴۵۶۷", example: ["09123334455", "09192223344", "09355556677"] },
      { key: "employee_number", labelFa: "شمارهٴ کارمندی", required: false, aliases: ["شماره کارمندی", "کد کارمندی"], digits: true, width: 16, hintFa: "اختیاری", example: ["", "", ""] },
    ],
  },
  {
    key: "teaching",
    nameFa: "دبیر-کلاس-درس",
    aliases: ["دبیر کلاس درس", "تدریس"],
    descriptionFa: "هر ردیف: یک دبیر یک درس را در یک کلاس (نوبت جاری) درس می‌دهد. دبیر با موبایل شناخته می‌شود؛ نام دبیر فقط برای خوانایی است.",
    columns: [
      { key: "teacher_phone", labelFa: "موبایل دبیر", required: true, requiredUnless: ["teacher_name"], aliases: ["موبایل", "شمارهٴ موبایل دبیر"], phone: true, width: 16, hintFa: "همان موبایل شیت دبیران", example: ["09123334455", "09192223344", "09355556677"] },
      { key: "teacher_name", labelFa: "نام دبیر", required: false, aliases: ["نام و نام خانوادگی دبیر", "نام"], width: 20, hintFa: "اختیاری؛ فقط برای خوانایی (بدون موبایل، دبیر با نام یکتا پیدا می‌شود)", example: ["حسین محمدی", "زهرا حسینی", "رضا نوری"] },
      { key: "teacher_last_name", labelFa: "نام خانوادگی دبیر", required: false, templateHidden: true, width: 20, hintFa: "", example: [] },
      { key: "class_name", labelFa: "کلاس", required: true, aliases: ["نام کلاس"], width: 12, hintFa: "دقیقاً همان نام در شیت کلاس‌ها", example: ["۱۰/۱", "۱۰/۱", "۱۰/۲"] },
      { key: "subject", labelFa: "درس", required: true, aliases: ["نام درس"], width: 16, hintFa: "نام یا کد درس، دقیقاً مثل سامانه", example: ["ریاضی", "فیزیک", "ادبیات فارسی"] },
    ],
  },
];

export const GUIDE_SHEET_NAME = "راهنما";

export const SHEET_BY_KEY: Record<SheetKey, SheetDef> = Object.fromEntries(SHEETS.map((s) => [s.key, s])) as Record<SheetKey, SheetDef>;

/** Loose header comparison: ZWNJ/spaces/ه‌ٴ variants collapse, Arabic letters → Persian. */
export function normalizeHeader(h: string): string {
  return h
    .replace(/[‌‍ـ]/g, "")
    .replace(/ٴ|ٔ/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/[\s ]+/g, "")
    .toLowerCase();
}

/** Column of a sheet by Persian header (label or alias) or by English key; null when unknown. */
export function findColumn(sheet: SheetDef, header: string): ColumnDef | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  for (const c of sheet.columns) {
    if (c.key === header.trim().toLowerCase()) return c;
    if (normalizeHeader(c.labelFa) === h) return c;
    if (c.aliases?.some((a) => normalizeHeader(a) === h)) return c;
  }
  return null;
}

/** Sheet definition by worksheet name (Persian name, alias or English key). */
export function findSheet(name: string): SheetDef | null {
  const n = normalizeHeader(name);
  for (const s of SHEETS) {
    if (s.key === name.trim().toLowerCase()) return s;
    if (normalizeHeader(s.nameFa) === n) return s;
    if (s.aliases?.some((a) => normalizeHeader(a) === n)) return s;
  }
  return null;
}
