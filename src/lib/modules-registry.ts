import {
  Bell,
  BookOpen,
  BookOpenCheck,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  ClipboardPlus,
  Clock,
  FileSpreadsheet,
  Handshake,
  HeartHandshake,
  Inbox,
  Layers,
  Library,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  Scale,
  School,
  Send,
  Settings2,
  ShieldAlert,
  Ticket,
  Trophy,
  UserCheck,
  Video,
  Wallet,
} from "lucide-react";
import type { ClayShade } from "@/components/ClayIcon";
import { schoolsLabelFa } from "@/lib/admin/nav";
import { GIVEN_TILE_ROLES, NEW_ITEM_TILE_ROLES, newItemLabel, workItemWordsForHats } from "@/lib/work-item-words";
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
    summary: "ورود امن، پنل من، اعلان‌ها، برنامهٴ کلاسی، حضور و غیاب و مدیریت ساختار مدرسه؛ نصب روی گوشی.",
  },
  2: {
    title: "فاز ۲",
    months: "مهر تا آبان ۱۴۰۵",
    summary:
      "دفتر کلاسی، موارد انضباطی، والدین، تابلو اعلانات و گزارش‌ها.",
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
      "تکالیفی که به شما داده شده یا خودتان داده‌اید، با مهلت و پیشرفت؛ و یادداشت‌های شخصی.",
  },
  {
    code: "notifications",
    labelFa: "اعلان‌ها",
    href: "/notifications",
    icon: Bell,
    permission: "notif.notification.read",
    phase: 1,
    descriptionFa: "خبرِ هر تغییر روی تکالیف شما، درون برنامه.",
  },
  {
    code: "admin",
    labelFa: "مدیریت",
    href: "/admin",
    icon: Settings2,
    permission: "iam.admin.access",
    phase: 1,
    descriptionFa:
      "مدرسه، کلاس‌ها، دانش‌آموزان، همکاران و حساب‌ها.",
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
    descriptionFa: "برنامهٴ هفتگی هر کلاس، زنگ به زنگ، برای دانش‌آموز و دبیر؛ زنگ‌بندی و برنامه را مدیر تنظیم می‌کند.",
  },

  {
    // Delivered in phase 1 (owner): class items ARE «تکالیف» — given from «تکلیف جدید», followed in «پنل من».
    code: "homework",
    labelFa: "تکالیف",
    href: "/inbox",
    icon: NotebookPen,
    permission: "workspace.work_item.read",
    phase: 1,
    competitorTerm: "تکلیف",
    descriptionFa: "تکلیف برای کلاس یا نفر، با مهلت و اولویت؛ دانش‌آموز انجام‌شدن را علامت می‌زند و دبیر پیشرفت را می‌بیند. فایل و نمره در فازهای بعد.",
  },
  {
    // Delivered in phase 1 (owner's ask): the teacher takes the roll call زنگ by زنگ, the student sees their own
    // month, the admin reads the class report — `/attendance` sends each hat to its own view.
    code: "attendance",
    labelFa: "حضور و غیاب",
    href: "/attendance",
    icon: UserCheck,
    permission: "academic.attendance.read",
    phase: 1,
    competitorTerm: "حضور و غیاب",
    descriptionFa: "ثبت زنگ به زنگ در کلاس، «حضور و غیاب من» برای دانش‌آموز، و گزارش درصد غیبت برای مدیر. اطلاع به والدین در فاز بعد.",
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
    descriptionFa: "حساب ولی با دیدِ فقط‌خواندنی به تکالیف، حضور و نمره‌ها.",
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
    descriptionFa: "خروجی اکسل و چاپ از حضور، نمره و تکالیف.",
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
    descriptionFa: "جزوه، فیلم و لینک درس، درس به درس، از دبیر برای کلاس.",
  },
  {
    code: "messages",
    labelFa: "پیام‌ها",
    href: "/roadmap#phase-3",
    icon: MessagesSquare,
    phase: 3,
    month: "آذر",
    competitorTerm: "همکلاسی",
    descriptionFa: "گفت‌وگوی دبیر با کلاس و با خانواده، زیر نظر مدرسه.",
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
    descriptionFa: "درخواست بازبینی نمره با پاسخ دبیر.",
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

/** Every signed-in member, hat or no hat («پنل من» is nobody's role — it is everyone's own work). */
export type TileAudience = TileRole | readonly TileRole[] | "everyone";

/** What `homeTilesFor` needs to know about the person — computed once by `HomeGrid` from `getHats`. */
export interface TileHats {
  isStudent: boolean;
  isTeacher: boolean;
  isAdmin: boolean;
  /** null when the person wears no admin hat. */
  adminScope: TileAdminScope | null;
  /** The one school a school-scoped admin holds (`Hats.adminSingleSchoolId`) — null for org and multi-school scopes. */
  singleSchoolId?: string | null;
}

export interface HomeTile {
  code: string;
  labelFa: string;
  href: string;
  icon: LucideIcon;
  /** The clay mark's shade — every live tile is the one blue; only «کار جدید» (the action) is `yellow`. */
  shade?: ClayShade;
  /**
   * Who sees the tile. A LIST when one destination genuinely belongs to two hats («حضور و غیاب» is the same page
   * for the teacher who takes it and the student who reads it) — the IA rule is one home per DESTINATION, so such
   * a place gets ONE tile, not one per role.
   */
  role: TileAudience;
  /** Shown only when the person holds it at any scope (the hat alone is not enough for admin tiles). */
  permission?: Permission;
  /**
   * Admin tiles only: shown to this admin scope alone. «راه‌اندازی مدرسه», «پایه‌ها», «درس‌ها» and «مقطع‌ها» are
   * `organization` — the owner's rule: whoever defines schools and the shared catalog is the organization admin;
   * principals and vice principals reach the catalog through their school's hub instead.
   */
  adminScope?: TileAdminScope;
  /**
   * An admin tile whose destination is ONE school's own page. `href(schoolId)` replaces the tile's href for an
   * admin of exactly one school (a list of one row is not a list — owner, QA round 3); `only` means the tile does
   * not exist for anyone else (زنگ‌بندی belongs to a school and has no organization-wide page); `label` swaps
   * «مدرسه‌ها» for «مدرسه».
   */
  oneSchool?: { href: (schoolId: string) => string; only?: boolean; label?: boolean };
  /** The glyph implies a direction (send, arrows) and must flip in RTL. */
  mirror?: boolean;
}

/**
 * The live tiles of the Home grid. Home is where a person's destinations live, and a destination has exactly ONE
 * door (docs/decisions.md «one home per destination»): nothing the bottom nav / side rail carries gets a tile
 * («بیشتر» and the role item — a student's «کلاس من», a teacher's «کلاس‌ها», an admin's «مدیریت» page), and
 * nothing the «بیشتر» page carries (راهنما, نقشهٴ راه, پروفایل).
 *
 * Round 5 (owner) settled three things. «پنل من» is a TILE, not a header control: the کارتابل is a place you tap
 * an icon to reach, and the tile carries the unread badge the control used to. «مدیریت» is now دانش‌آموزان ·
 * کارکنان · کلاس‌ها · نقش‌ها alone — every STRUCTURE page (مدرسه‌ها، سال تحصیلی، زنگ‌بندی، پایه‌ها، درس‌ها، مقطع‌ها،
 * راه‌اندازی مدرسه) and the admin's «حضور و غیاب» report left the admin nav and became its own tile here, gated by
 * the very permission and scope that guard its page, so an admin reaches each of them in one tap and never meets
 * it twice. And «مدیریت» itself lost its tile: the nav's first cell already opens /admin for an admin, so the
 * tile was a second door. «اعلان‌ها» stays a header control (the bell).
 *
 * Order: «پنل من» first (everyone's own work), then the person's role tiles, then the structure tiles by how
 * often an admin opens them, setup last. `homeTilesFor` picks per person.
 */
export const HOME_TILES: readonly HomeTile[] = [
  {
    // Home's ONE door to the کارتابل (round 5). The «امروز» strip's three links are FILTERS of it, not a door.
    code: "inbox",
    labelFa: "پنل من",
    href: "/inbox",
    icon: Inbox,
    role: "everyone",
    permission: "workspace.work_item.read",
  },

  {
    // The mirror of the creation tile: what I have given. The hats that give work to OTHER people
    // (`GIVEN_TILE_ROLES`) — never the student, whose تسک is their own — and the same role-aware word:
    // «تکالیف داده‌شده» for a teaching hat, «تسک‌های داده‌شده» otherwise.
    code: "given",
    labelFa: "تکالیف داده‌شده",
    href: "/inbox?mine=1",
    icon: Send,
    role: GIVEN_TILE_ROLES,
    permission: "workspace.work_item.create",
    mirror: true,
  },
  {
    // The ONE creation door on Home, for every hat that may open a کار (`NEW_ITEM_TILE_ROLES`): a دبیر, an
    // admin — and, since round 6, a student, whose own item is a personal «تسک». The label is role-aware
    // and `homeTilesFor` rewrites it per person (`newItemLabel`); the permission check is unchanged, so the
    // tile appears for a student only once the catalog grants them `workspace.work_item.create`.
    code: "new-item",
    shade: "yellow",
    labelFa: "تکلیف جدید",
    href: "/inbox/new",
    icon: ClipboardPlus,
    role: NEW_ITEM_TILE_ROLES,
    permission: "workspace.work_item.create",
  },

  {
    // One destination for two hats: the teacher takes today's roll call, the student reads their own month.
    // The ADMIN's report is a different page and has its own tile below (`admin-attendance`).
    code: "attendance",
    labelFa: "حضور و غیاب",
    href: "/attendance",
    icon: UserCheck,
    role: ["student", "teacher"],
    permission: "academic.attendance.read",
  },

  // No «مدیریت» tile: the nav's first cell IS «مدیریت» for an admin (owner, round 5), so a tile would be a
  // second door to the people area. The tiles below are the destinations the nav no longer carries.
  {
    // The admin's OWN «حضور و غیاب»: the class report and «امروز ثبت نشده». A different destination from the
    // teacher/student tile above (`/attendance`), and a different audience — `academic.attendance.report` is the
    // permission its queries check, which a teacher does not hold. One tile per audience, one door each.
    code: "admin-attendance",
    labelFa: "حضور و غیاب",
    href: "/admin/attendance",
    icon: UserCheck,
    role: "admin",
    permission: "academic.attendance.report",
  },
  {
    // «مدرسه» for an admin of exactly one school — straight to that school's hub, where its structure is edited.
    // SCHOOL-SCOPED admins only (round 7): the organization admin, who defines the schools, reaches the list
    // through the «مدرسه‌ها» admin SECTION instead, so neither of them meets the destination twice.
    code: "schools",
    labelFa: "مدرسه‌ها",
    href: "/admin/schools",
    icon: School,
    role: "admin",
    permission: "tenancy.structure.read",
    adminScope: "school",
    oneSchool: { href: (id) => `/admin/schools/${id}`, label: true },
  },
  {
    code: "years",
    labelFa: "سال تحصیلی",
    href: "/admin/years",
    icon: CalendarDays,
    role: "admin",
    permission: "tenancy.structure.write",
  },
  {
    // A زنگ‌بندی belongs to ONE school and has no organization-wide page; an admin of several reaches it through
    // each school's hub («مدرسه‌ها» → the school → زنگ‌بندی).
    code: "periods",
    labelFa: "زنگ‌بندی",
    // Empty on purpose: `oneSchool.only` drops this tile unless `homeTilesFor` rewrites the href with the school
    // it belongs to, so the placeholder is never rendered (`tests/unit/home-tiles.test.ts` guards it).
    href: "",
    icon: Clock,
    role: "admin",
    permission: "tenancy.structure.write",
    oneSchool: { href: (id) => `/admin/schools/${id}/periods`, only: true },
  },
  {
    code: "grades",
    labelFa: "پایه‌ها",
    href: "/admin/grades",
    icon: Layers,
    role: "admin",
    permission: "tenancy.structure.write",
    adminScope: "organization",
  },
  {
    code: "subjects",
    labelFa: "درس‌ها",
    href: "/admin/subjects",
    icon: BookOpen,
    role: "admin",
    permission: "tenancy.structure.write",
    adminScope: "organization",
  },
  {
    code: "levels",
    labelFa: "مقطع‌ها",
    href: "/admin/levels",
    icon: Layers,
    role: "admin",
    permission: "tenancy.structure.write",
    adminScope: "organization",
  },
  // No «راه‌اندازی مدرسه» tile (round 7): the setup checklist is an admin SECTION now, beside «مدرسه‌ها» —
  // one door, and it is inside /admin where the rest of the organization admin's setup work already is.
];

/**
 * The tiles a person with these hats sees, in grid order. `has` answers «holds this permission at any scope?»;
 * a tile with `adminScope` additionally needs the admin hat to reach that far (`hats.adminScope`), and a tile
 * with `oneSchool` is rewritten (or dropped) by whether the admin holds exactly one school.
 */
export function homeTilesFor(
  hats: TileHats,
  has: (p: Permission) => boolean,
): HomeTile[] {
  const wearsOne = (role: TileRole) =>
    (role === "student" && hats.isStudent) ||
    (role === "teacher" && hats.isTeacher) ||
    (role === "admin" && hats.isAdmin);
  const wears = (role: TileAudience) => role === "everyone" || (Array.isArray(role) ? role.some(wearsOne) : wearsOne(role as TileRole));
  const schoolId = hats.singleSchoolId ?? null;
  return HOME_TILES.filter(
    (t) =>
      wears(t.role) &&
      (!t.permission || has(t.permission)) &&
      (!t.adminScope || hats.adminScope === t.adminScope) &&
      (!t.oneSchool?.only || schoolId !== null),
  ).map((t) => {
    // The creation tile speaks the person's own word: «تکلیف جدید» for a teaching hat, «تسک جدید» for an
    // admin who does not teach and for a student (`newItemLabel` — the same rule as the form and the کارتابل).
    if (t.code === "new-item") return { ...t, labelFa: newItemLabel(hats) };
    if (t.code === "given") return { ...t, labelFa: workItemWordsForHats(hats).given };
    return t.oneSchool && schoolId
      ? { ...t, href: t.oneSchool.href(schoolId), ...(t.oneSchool.label ? { labelFa: schoolsLabelFa({ kind: "school", schoolIds: [schoolId] }) } : {}) }
      : t;
  });
}

/** The muted «به‌زودی» tiles: the owner's list of the competitor's modules we do not have yet, in phase/month order. */
const HOME_UPCOMING_CODES = [
  "classbook",
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
