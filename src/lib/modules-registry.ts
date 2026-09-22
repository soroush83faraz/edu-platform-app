import {
  Bell,
  BookOpenCheck,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  ClipboardPlus,
  FileSpreadsheet,
  GraduationCap,
  Handshake,
  HeartHandshake,
  Inbox,
  Library,
  ListChecks,
  ListTodo,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  Presentation,
  Printer,
  Rocket,
  Scale,
  School,
  Send,
  Settings2,
  ShieldAlert,
  Ticket,
  Trophy,
  UserCheck,
  Users,
  Video,
  Wallet,
} from "lucide-react";
import type { ClayShade } from "@/components/ClayIcon";
import type { Permission } from "@/modules/iam/permissions";

/**
 * The product map: what is live now and what each later phase brings, with the client's own vocabulary
 * (`competitorTerm`) in parentheses so principals recognise it. Drives /roadmap, the «به‌زودی» hint on /more and
 * the muted «به‌زودی» tiles of the Home grid (`HOME_UPCOMING`). Phase 1 entries are links.
 */
export interface ModuleEntry {
  code: string;
  labelFa: string;
  href: string;
  /** The module's glyph — one lucide icon per module, chosen once here so every surface draws the same one. */
  icon: LucideIcon;
  permission?: Permission;
  phase: 1 | 2 | 3 | 4;
  /** Jalali month(s) the phase lands in, e.g. «مهر». */
  month?: string;
  /** How the client's current app names this feature. */
  competitorTerm?: string;
  /** One line of what the module does — shown on /roadmap. */
  descriptionFa: string;
}

export const PHASES: Record<
  ModuleEntry["phase"],
  { title: string; months: string; summary: string }
> = {
  1: {
    title: "فاز ۱ — اکنون فعال",
    months: "شهریور ۱۴۰۵",
    summary: "ورود امن، پنل من، اعلان‌ها، برنامهٴ کلاسی و مدیریت ساختار مدرسه؛ نصب روی گوشی.",
  },
  2: {
    title: "فاز ۲",
    months: "مهر تا آبان ۱۴۰۵",
    summary:
      "کلاس‌داری روزانه: تکلیف، حضور و غیاب، دفتر کلاسی، والدین و گزارش‌ها.",
  },
  3: {
    title: "فاز ۳",
    months: "آذر تا دی ۱۴۰۵",
    summary: "آزمون، گفت‌وگو، مشاوره و انگیزش دانش‌آموزان.",
  },
  4: {
    title: "فاز ۴",
    months: "بهمن تا اسفند ۱۴۰۵",
    summary: "امور مالی و کلاس آنلاین.",
  },
};

export const MODULES: readonly ModuleEntry[] = [
  {
    code: "inbox",
    labelFa: "پنل من",
    href: "/inbox",
    icon: Inbox,
    permission: "workspace.work_item.read",
    phase: 1,
    descriptionFa:
      "کارهایی که به شما سپرده شده یا خودتان داده‌اید، با مهلت و پیشرفت.",
  },
  {
    code: "notifications",
    labelFa: "اعلان‌ها",
    href: "/notifications",
    icon: Bell,
    permission: "notif.notification.read",
    phase: 1,
    descriptionFa: "خبرِ هر تغییر روی کارهای شما، درون برنامه.",
  },
  {
    code: "admin",
    labelFa: "مدیریت",
    href: "/admin",
    icon: Settings2,
    permission: "iam.admin.access",
    phase: 1,
    descriptionFa:
      "مدرسه، کلاس‌ها، دانش‌آموزان، همکاران، حساب‌ها و اعتبارنامه‌ها.",
  },
  {
    // Delivered in phase 1 (owner's ask): /timetable sends each hat to its own view — «کلاس من», «کلاس‌های من», the admin class pages.
    code: "class-schedule",
    labelFa: "برنامهٴ کلاسی",
    href: "/timetable",
    icon: CalendarDays,
    permission: "academic.timetable.read",
    phase: 1,
    competitorTerm: "برنامهٴ کلاسی",
    descriptionFa: "برنامهٴ هفتگی هر کلاس، زنگ به زنگ، برای دانش‌آموز و معلم؛ زنگ‌بندی و برنامه را مدیر تنظیم می‌کند.",
  },

  {
    code: "homework",
    labelFa: "تکالیف",
    href: "/roadmap#phase-2",
    icon: NotebookPen,
    phase: 2,
    month: "مهر",
    competitorTerm: "تکلیف",
    descriptionFa:
      "تکلیف با فایل، تحویل و نمره؛ کار امروزِ پنل من شکل کامل‌تر می‌گیرد.",
  },
  {
    code: "classbook",
    labelFa: "دفتر کلاسی",
    href: "/roadmap#phase-2",
    icon: BookOpenCheck,
    phase: 2,
    month: "مهر",
    competitorTerm: "دفتر کلاسی",
    descriptionFa: "نمرهٴ مستمر و یادداشت جلسه به جلسه برای هر درس.",
  },
  {
    code: "attendance",
    labelFa: "حضور و غیاب",
    href: "/roadmap#phase-2",
    icon: UserCheck,
    phase: 2,
    month: "مهر",
    competitorTerm: "حضور و غیاب",
    descriptionFa: "ثبت روزانه در کلاس، گزارش به والدین.",
  },
  {
    code: "discipline",
    labelFa: "موارد انضباطی",
    href: "/roadmap#phase-2",
    icon: ShieldAlert,
    phase: 2,
    month: "آبان",
    competitorTerm: "موارد انضباطی",
    descriptionFa: "ثبت مورد، اطلاع به خانواده، پیگیری معاون.",
  },
  {
    code: "guardians",
    labelFa: "والدین",
    href: "/roadmap#phase-2",
    icon: HeartHandshake,
    phase: 2,
    month: "آبان",
    competitorTerm: "والدین",
    descriptionFa: "حساب ولی با دیدِ فقط‌خواندنی به کارها، حضور و نمره‌ها.",
  },
  {
    code: "board",
    labelFa: "تابلو اعلانات",
    href: "/roadmap#phase-2",
    icon: Megaphone,
    phase: 2,
    month: "آبان",
    competitorTerm: "تابلو اعلانات",
    descriptionFa: "اطلاعیهٴ مدرسه برای کلاس، پایه یا همه.",
  },
  {
    code: "reports",
    labelFa: "گزارش‌ها",
    href: "/roadmap#phase-2",
    icon: FileSpreadsheet,
    phase: 2,
    month: "آبان",
    competitorTerm: "گزارش‌ها",
    descriptionFa: "خروجی اکسل و چاپ از حضور، نمره و کارها.",
  },
  {
    code: "requests",
    labelFa: "درخواست‌ها",
    href: "/roadmap#phase-2",
    icon: Ticket,
    phase: 2,
    month: "آبان تا آذر",
    competitorTerm: "تیکت‌ها",
    descriptionFa: "درخواستِ دانش‌آموز یا ولی به دفتر، با وضعیت و پاسخ.",
  },

  {
    code: "exams",
    labelFa: "آزمون",
    href: "/roadmap#phase-3",
    icon: ClipboardCheck,
    phase: 3,
    month: "آذر",
    competitorTerm: "آزمون",
    descriptionFa: "آزمون آنلاین و برگه‌ای، کارنامه.",
  },
  {
    code: "exam-schedule",
    labelFa: "برنامهٴ امتحانی",
    href: "/roadmap#phase-3",
    icon: CalendarCheck,
    phase: 3,
    month: "آذر",
    competitorTerm: "برنامهٴ امتحانی",
    descriptionFa: "تقویم آزمون‌های هر کلاس، با یادآوری در پنل من.",
  },
  {
    code: "content",
    labelFa: "محتوای آموزشی",
    href: "/roadmap#phase-3",
    icon: Library,
    phase: 3,
    month: "آذر",
    competitorTerm: "محتوای آموزشی",
    descriptionFa: "جزوه، فیلم و لینک درس، درس به درس، از معلم برای کلاس.",
  },
  {
    code: "messages",
    labelFa: "پیام‌ها",
    href: "/roadmap#phase-3",
    icon: MessagesSquare,
    phase: 3,
    month: "آذر",
    competitorTerm: "همکلاسی",
    descriptionFa: "گفت‌وگوی معلم با کلاس و با خانواده، زیر نظر مدرسه.",
  },
  {
    code: "counseling",
    labelFa: "مشاوره",
    href: "/roadmap#phase-3",
    icon: Handshake,
    phase: 3,
    month: "دی",
    competitorTerm: "مشاوره",
    descriptionFa: "نوبت و پروندهٴ مشاوره، محرمانه.",
  },
  {
    code: "points",
    labelFa: "کیف امتیازی",
    href: "/roadmap#phase-3",
    icon: Trophy,
    phase: 3,
    month: "دی",
    competitorTerm: "دانش‌آموزان ممتاز",
    descriptionFa: "امتیاز و تشویق برای رفتار و پیشرفت.",
  },
  {
    code: "grade-appeal",
    labelFa: "اعتراض نمره",
    href: "/roadmap#phase-3",
    icon: Scale,
    phase: 3,
    month: "دی",
    competitorTerm: "اعتراض نمره",
    descriptionFa: "درخواست بازبینی نمره با پاسخ معلم.",
  },

  {
    code: "finance",
    labelFa: "حساب مالی",
    href: "/roadmap#phase-4",
    icon: Wallet,
    phase: 4,
    month: "بهمن",
    competitorTerm: "حساب مالی",
    descriptionFa: "شهریه، اقساط و پرداخت آنلاین.",
  },
  {
    code: "online-class",
    labelFa: "جلسات آنلاین",
    href: "/roadmap#phase-4",
    icon: Video,
    phase: 4,
    month: "اسفند",
    competitorTerm: "جلسات آنلاین",
    descriptionFa: "کلاس زندهٴ درون برنامه با ضبط جلسه.",
  },
];

export const LIVE_MODULES = MODULES.filter((m) => m.phase === 1);
export const UPCOMING_MODULES = MODULES.filter((m) => m.phase > 1);

// ---------------------------------------------------------------------------------------------------------------
// Home grid
// ---------------------------------------------------------------------------------------------------------------

/** Who sees a tile: a hat derived by `getHats` (student profile, teaching offerings, admin scope). */
export type TileRole = "student" | "teacher" | "admin";

/** The admin hat's reach (`getAdminScope().kind`): the whole organization, or the caller's schools. */
export type TileAdminScope = "organization" | "school";

/** What `homeTilesFor` needs to know about the person — computed once by `HomeGrid` from `getHats`. */
export interface TileHats {
  isStudent: boolean;
  isTeacher: boolean;
  isAdmin: boolean;
  /** null when the person wears no admin hat. */
  adminScope: TileAdminScope | null;
}

/** Live numbers a tile may carry — today only the school-onboarding progress (unread counts live on the nav). */
export type TileBadge = "onboarding";

export interface HomeTile {
  code: string;
  labelFa: string;
  href: string;
  icon: LucideIcon;
  /** The clay mark's shade — every live tile is the one blue; only «کار جدید» (the action) is `yellow`. */
  shade?: ClayShade;
  role: TileRole;
  /** Shown only when the person holds it at any scope (the hat alone is not enough for admin tiles). */
  permission?: Permission;
  /**
   * Admin tiles only: shown to this admin scope alone. «راه‌اندازی مدرسه» is `organization` — the owner's rule: only
   * the organization admin defines schools, so school setup is theirs; principals and vice principals never see it.
   */
  adminScope?: TileAdminScope;
  badge?: TileBadge;
  /** The glyph implies a direction (send, arrows) and must flip in RTL. */
  mirror?: boolean;
}

/**
 * The live tiles of the Home grid: ONLY a hat's own tiles — nothing the bottom nav / side rail (کارتابل, اعلان‌ها,
 * بیشتر) or the «بیشتر» page (راهنما, نقشهٴ راه, پروفایل) already offers. `homeTilesFor` picks per person; the
 * order is student → teacher → admin so a multi-hat person reads their most personal tiles first.
 */
export const HOME_TILES: readonly HomeTile[] = [
  {
    code: "my-todo",
    labelFa: "کارهای من",
    href: "/inbox?tab=todo",
    icon: ListTodo,
    role: "student",
  },
  {
    code: "my-done",
    labelFa: "انجام‌شده",
    href: "/inbox?tab=done",
    icon: ListChecks,
    role: "student",
  },
  {
    code: "my-class",
    labelFa: "کلاس من",
    href: "/my-class",
    icon: School,
    role: "student",
  },
  {
    code: "timetable",
    labelFa: "برنامهٴ کلاسی",
    href: "/my-class",
    icon: CalendarDays,
    role: "student",
    permission: "academic.timetable.read",
  },

  {
    code: "classes",
    labelFa: "کلاس‌های من",
    href: "/classes",
    icon: Presentation,
    role: "teacher",
  },
  {
    code: "teacher-timetable",
    labelFa: "برنامهٴ کلاسی",
    href: "/classes",
    icon: CalendarDays,
    role: "teacher",
    permission: "academic.timetable.read",
  },
  {
    code: "given",
    labelFa: "کارهایی که دادم",
    href: "/inbox?mine=1",
    icon: Send,
    role: "teacher",
    mirror: true,
  },
  {
    code: "new-item",
    shade: "yellow",
    labelFa: "کار جدید",
    href: "/inbox/new",
    icon: ClipboardPlus,
    role: "teacher",
    permission: "workspace.work_item.create",
  },

  {
    code: "admin",
    labelFa: "مدیریت",
    href: "/admin",
    icon: Settings2,
    role: "admin",
    permission: "iam.admin.access",
  },
  {
    code: "students",
    labelFa: "دانش‌آموزان",
    href: "/admin/students",
    icon: GraduationCap,
    role: "admin",
    permission: "iam.admin.access",
  },
  {
    code: "staff",
    labelFa: "کارکنان",
    href: "/admin/staff",
    icon: Users,
    role: "admin",
    permission: "iam.admin.access",
  },
  {
    code: "admin-classes",
    labelFa: "کلاس‌ها",
    href: "/admin/classes",
    icon: School,
    role: "admin",
    permission: "iam.admin.access",
  },
  {
    code: "onboarding",
    labelFa: "راه‌اندازی مدرسه",
    href: "/admin/onboarding",
    icon: Rocket,
    role: "admin",
    permission: "iam.admin.access",
    adminScope: "organization",
    badge: "onboarding",
  },
  {
    code: "credentials",
    labelFa: "چاپ اعتبارنامه",
    href: "/admin/classes",
    icon: Printer,
    role: "admin",
    permission: "iam.admin.access",
  },
];

/**
 * The tiles a person with these hats sees, in grid order. `has` answers «holds this permission at any scope?»;
 * a tile with `adminScope` additionally needs the admin hat to reach that far (`hats.adminScope`).
 */
export function homeTilesFor(
  hats: TileHats,
  has: (p: Permission) => boolean,
): HomeTile[] {
  const wears = (role: TileRole) =>
    (role === "student" && hats.isStudent) ||
    (role === "teacher" && hats.isTeacher) ||
    (role === "admin" && hats.isAdmin);
  return HOME_TILES.filter(
    (t) =>
      wears(t.role) &&
      (!t.permission || has(t.permission)) &&
      (!t.adminScope || hats.adminScope === t.adminScope),
  );
}

/** The muted «به‌زودی» tiles: the owner's list of the competitor's modules we do not have yet, in phase/month order. */
const HOME_UPCOMING_CODES = [
  "homework",
  "classbook",
  "attendance",
  "discipline",
  "guardians",
  "requests",
  "exam-schedule",
  "content",
  "messages",
  "counseling",
  "points",
  "grade-appeal",
  "finance",
];
export const HOME_UPCOMING: readonly ModuleEntry[] = HOME_UPCOMING_CODES.map(
  (code) => {
    const m = MODULES.find((x) => x.code === code);
    if (!m) throw new Error(`HOME_UPCOMING: unknown module ${code}`);
    return m;
  },
);
