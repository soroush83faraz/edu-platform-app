import type { Permission } from "@/modules/iam/permissions";

/**
 * The product map: what is live now and what each later phase brings, with the client's own vocabulary
 * (`competitorTerm`) in parentheses so principals recognise it. Drives the «بخش‌ها» row on Home and /roadmap.
 * Phase 1 entries are links; later phases render as «به‌زودی» chips that open /roadmap.
 */
export interface ModuleEntry {
  code: string;
  labelFa: string;
  href: string;
  permission?: Permission;
  phase: 1 | 2 | 3 | 4;
  /** Jalali month(s) the phase lands in, e.g. «مهر». */
  month?: string;
  /** How the client's current app names this feature. */
  competitorTerm?: string;
  /** One line of what the module does — shown on /roadmap. */
  descriptionFa: string;
}

export const PHASES: Record<ModuleEntry["phase"], { title: string; months: string; summary: string }> = {
  1: { title: "فاز ۱ — اکنون فعال", months: "شهریور ۱۴۰۵", summary: "ورود امن، کارتابل، اعلان‌ها و مدیریت ساختار مدرسه؛ نصب روی گوشی." },
  2: { title: "فاز ۲", months: "مهر تا آبان ۱۴۰۵", summary: "کلاس‌داری روزانه: تکلیف، حضور و غیاب، دفتر کلاسی، والدین و گزارش‌ها." },
  3: { title: "فاز ۳", months: "آذر تا دی ۱۴۰۵", summary: "آزمون، گفت‌وگو، مشاوره و انگیزش دانش‌آموزان." },
  4: { title: "فاز ۴", months: "بهمن تا اسفند ۱۴۰۵", summary: "امور مالی و کلاس آنلاین." },
};

export const MODULES: readonly ModuleEntry[] = [
  { code: "inbox", labelFa: "کارتابل", href: "/inbox", permission: "workspace.work_item.read", phase: 1, descriptionFa: "کارهایی که به شما سپرده شده یا خودتان داده‌اید، با مهلت و پیشرفت." },
  { code: "notifications", labelFa: "اعلان‌ها", href: "/notifications", permission: "notif.notification.read", phase: 1, descriptionFa: "خبرِ هر تغییر روی کارهای شما، درون برنامه." },
  { code: "admin", labelFa: "مدیریت", href: "/admin", permission: "iam.admin.access", phase: 1, descriptionFa: "مدرسه، کلاس‌ها، دانش‌آموزان، همکاران، حساب‌ها و اعتبارنامه‌ها." },

  { code: "homework", labelFa: "تکالیف", href: "/roadmap#phase-2", phase: 2, month: "مهر", competitorTerm: "تکلیف", descriptionFa: "تکلیف با فایل، تحویل و نمره؛ کار امروزِ کارتابل شکل کامل‌تر می‌گیرد." },
  { code: "classbook", labelFa: "دفتر کلاسی", href: "/roadmap#phase-2", phase: 2, month: "مهر", competitorTerm: "دفتر کلاسی", descriptionFa: "نمرهٴ مستمر و یادداشت جلسه به جلسه برای هر درس." },
  { code: "attendance", labelFa: "حضور و غیاب", href: "/roadmap#phase-2", phase: 2, month: "مهر", competitorTerm: "حضور و غیاب", descriptionFa: "ثبت روزانه در کلاس، گزارش به والدین." },
  { code: "discipline", labelFa: "موارد انضباطی", href: "/roadmap#phase-2", phase: 2, month: "آبان", competitorTerm: "موارد انضباطی", descriptionFa: "ثبت مورد، اطلاع به خانواده، پیگیری معاون." },
  { code: "guardians", labelFa: "والدین", href: "/roadmap#phase-2", phase: 2, month: "آبان", competitorTerm: "والدین", descriptionFa: "حساب ولی با دیدِ فقط‌خواندنی به کارها، حضور و نمره‌ها." },
  { code: "board", labelFa: "تابلو اعلانات", href: "/roadmap#phase-2", phase: 2, month: "آبان", competitorTerm: "تابلو اعلانات", descriptionFa: "اطلاعیهٴ مدرسه برای کلاس، پایه یا همه." },
  { code: "reports", labelFa: "گزارش‌ها", href: "/roadmap#phase-2", phase: 2, month: "آبان", competitorTerm: "گزارش‌ها", descriptionFa: "خروجی اکسل و چاپ از حضور، نمره و کارها." },
  { code: "requests", labelFa: "درخواست‌ها", href: "/roadmap#phase-2", phase: 2, month: "آبان تا آذر", competitorTerm: "تیکت‌ها", descriptionFa: "درخواستِ دانش‌آموز یا ولی به دفتر، با وضعیت و پاسخ." },

  { code: "exams", labelFa: "آزمون", href: "/roadmap#phase-3", phase: 3, month: "آذر", competitorTerm: "آزمون", descriptionFa: "آزمون آنلاین و برگه‌ای، کارنامه." },
  { code: "messages", labelFa: "پیام‌ها", href: "/roadmap#phase-3", phase: 3, month: "آذر", competitorTerm: "همکلاسی", descriptionFa: "گفت‌وگوی معلم با کلاس و با خانواده، زیر نظر مدرسه." },
  { code: "counseling", labelFa: "مشاوره", href: "/roadmap#phase-3", phase: 3, month: "دی", competitorTerm: "مشاوره", descriptionFa: "نوبت و پروندهٴ مشاوره، محرمانه." },
  { code: "points", labelFa: "کیف امتیازی", href: "/roadmap#phase-3", phase: 3, month: "دی", competitorTerm: "دانش‌آموزان ممتاز", descriptionFa: "امتیاز و تشویق برای رفتار و پیشرفت." },
  { code: "grade-appeal", labelFa: "اعتراض نمره", href: "/roadmap#phase-3", phase: 3, month: "دی", competitorTerm: "اعتراض نمره", descriptionFa: "درخواست بازبینی نمره با پاسخ معلم." },

  { code: "finance", labelFa: "حساب مالی", href: "/roadmap#phase-4", phase: 4, month: "بهمن", competitorTerm: "حساب مالی", descriptionFa: "شهریه، اقساط و پرداخت آنلاین." },
  { code: "online-class", labelFa: "جلسات آنلاین", href: "/roadmap#phase-4", phase: 4, month: "اسفند", competitorTerm: "جلسات آنلاین", descriptionFa: "کلاس زندهٴ درون برنامه با ضبط جلسه." },
];

export const LIVE_MODULES = MODULES.filter((m) => m.phase === 1);
export const UPCOMING_MODULES = MODULES.filter((m) => m.phase > 1);
