import {
  AlarmClock,
  Bell,
  BookOpenCheck,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  Handshake,
  HeartHandshake,
  Inbox,
  Lectern,
  Library,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  Presentation,
  Scale,
  School,
  Settings2,
  ShieldAlert,
  Ticket,
  Trophy,
  UserCheck,
  Video,
  Wallet,
} from "lucide-react";
import type { ClayShade } from "@/components/ClayIcon";
import { ADMIN_SECTIONS, type AdminSectionKey, schoolsLabelFa } from "@/lib/admin/nav";
import type { UiVariant } from "@/lib/ui-variant";
import type { Permission } from "@/modules/iam/permissions";

/**
 * The product map: what is live now and what each later phase brings, with the client's own vocabulary
 * (`competitorTerm`) in parentheses so principals recognise it. Drives /roadmap, the «به‌زودی» hint on «بیشتر ←
 * نقشهٴ راه» and, in the hub layout, Home's own «به‌زودی» section (owner, 2026-09-27: grey, non-interactive tiles
 * under the live ones, per `soonFor` — never a door; `upcomingTilesFor`). Phase 1 entries are links.
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
  /**
   * Upcoming modules only: whose hub Home shows it as a grey «به‌زودی» tile (owner, 2026-09-27) — the hats that
   * will actually use it. Omitted = nobody's Home (the roadmap still lists it).
   */
  soonFor?: TileAudience;
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
    labelFa: "برنامهٴ هفتگی",
    href: "/timetable",
    icon: CalendarDays,
    permission: "academic.timetable.read",
    phase: 1,
    competitorTerm: "برنامهٴ کلاسی",
    descriptionFa: "برنامهٴ هفتگی هر کلاس، زنگ به زنگ، برای دانش‌آموز و دبیر؛ برنامهٴ کلاسی و زنگ‌ها را مدیر تنظیم می‌کند.",
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
    soonFor: ["teacher", "admin"],
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
    soonFor: ["teacher", "admin"],
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
    soonFor: "admin",
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
    soonFor: "everyone",
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
    soonFor: ["teacher", "admin"],
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
    soonFor: "everyone",
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
    soonFor: ["student", "teacher"],
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
    soonFor: "everyone",
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
    soonFor: ["student", "teacher"],
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
    soonFor: "everyone",
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
    soonFor: ["student", "admin"],
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
    soonFor: ["student", "teacher"],
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
    soonFor: ["student", "teacher"],
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
    soonFor: ["student", "admin"],
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
    soonFor: ["student", "teacher"],
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

/** Every signed-in member, hat or no hat. */
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
  /** The clay mark's shade — every live tile is the one blue; `yellow` is reserved for the one action / high-priority case. */
  shade?: ClayShade;
  /**
   * Who sees the tile. A LIST when one destination genuinely belongs to two hats («حضور و غیاب» is the same page
   * for the teacher who takes it and the student who reads it) — the IA rule is one home per DESTINATION, so such
   * a place gets ONE tile, not one per role.
   */
  role: TileAudience;
  /**
   * Hidden when the person ALSO wears this hat — for a place two hats reach on different pages under one name
   * (hub layout: a teaching student's «برنامهٴ هفتگی» is the teaching week, so the class week steps aside).
   */
  exceptRole?: TileRole;
  /** Shown only when the person holds it at any scope (the hat alone is not enough for admin tiles). */
  permission?: Permission;
  /**
   * Admin tiles only: shown to this admin scope alone — e.g. «مدرسه» / «مدرسه‌ها» is `school` (the organization
   * admin has the «مدرسه‌ها» section instead). The structure catalog has no tile: مقطع‌ها، پایه‌ها and سال‌ها are
   * fixed, and درس‌ها live under «مدرسه‌ها» (2026-09-27).
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
  /**
   * The label to use when another tile the SAME person sees already reads `labelFa` — two destinations never share
   * a name (hub layout: a teaching principal's roll call and the admin report are both «حضور و غیاب»).
   */
  altLabelFa?: string;
  /**
   * The glyph to use when another tile the SAME person sees already draws `icon` — no two tiles share a glyph (hub
   * layout: a teaching principal's «کلاس‌های من» beside the admin «کلاس‌ها», the roll call beside the report).
   */
  altIcon?: LucideIcon;
}

/**
 * The live tiles of the Home grid. Home is where a person's destinations live, and a destination has exactly ONE
 * door (docs/decisions.md «one home per destination»): nothing the bottom nav / side rail carries gets a tile
 * («بیشتر» and the role item — a student's «کلاس من», a teacher's «کلاس‌ها», an admin's «مدیریت» page), and
 * nothing the «بیشتر» page carries (راهنما, نقشهٴ راه, پروفایل).
 *
 * Round 5 (owner) settled two things — a third, «پنل من» as a tile, went back and forth: dropped on nav round
 * 2026-09-27 (the کارتابل's one door became Home's «تکالیف نزدیک» card and its «همهٴ …» link), then restored on
 * 2026-09-27 (owner, docs/decisions-pending/nav-home.md): it is a tile again, beside «حضور و غیاب», and the card's
 * link stays too — the owner accepts two doors to that one destination. «مدیریت» is now دانش‌آموزان ·
 * کارکنان · کلاس‌ها · نقش‌ها alone — every STRUCTURE page (مدرسه‌ها، سال تحصیلی، زنگ‌بندی، پایه‌ها، درس‌ها، مقطع‌ها،
 * راه‌اندازی مدرسه) and the admin's «حضور و غیاب» report left the admin nav and became its own tile here, gated by
 * the very permission and scope that guard its page, so an admin reaches each of them in one tap and never meets
 * it twice. And «مدیریت» itself lost its tile: the nav's role cell already opens /admin for an admin, so the
 * tile was a second door. «اعلان‌ها» stays a header control (the bell).
 *
 * Order: «پنل من», then the person's role tiles, then the structure tiles by how often an admin opens them. `homeTilesFor` picks per person.
 */
export const HOME_TILES: readonly HomeTile[] = [
  {
    // Back as a Home tile (owner, 2026-09-27, docs/decisions-pending/nav-home.md): shown to EVERY role that reads
    // work items — student, teacher, every admin — so it leads the grid, immediately before «حضور و غیاب» /
    // «حضور و غیاب» admin below, the two side by side. The card's «همهٴ …» link stays too — the owner accepts
    // two doors to this one destination. Nor a «کار جدید» creation tile (owner, 2026-09-27): creating one is
    // reached only from the inbox page's own header button, so Home carries no second door to THAT.
    code: "inbox",
    labelFa: "پنل من",
    href: "/inbox",
    icon: Inbox,
    role: ["student", "teacher", "admin"],
    permission: "workspace.work_item.read",
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

  // No «مدیریت» tile: the nav's role cell IS «مدیریت» for an admin (owner, round 5), so a tile would be a
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
    // A زنگ‌بندی belongs to ONE school and has no organization-wide page; an admin of several reaches it through
    // each school's hub («مدرسه‌ها» → the school → زنگ‌بندی).
    code: "periods",
    labelFa: "برنامهٴ کلاسی",
    // Empty on purpose: `oneSchool.only` drops this tile unless `homeTilesFor` rewrites the href with the school
    // it belongs to, so the placeholder is never rendered (`tests/unit/home-tiles.test.ts` guards it).
    href: "",
    // A bell schedule: the alarm clock is time AND bell, without echoing the notifications bell in the top bar.
    icon: AlarmClock,
    role: "admin",
    permission: "tenancy.structure.write",
    oneSchool: { href: (id) => `/admin/schools/${id}/periods`, only: true },
  },
  // No «راه‌اندازی مدرسه» tile (round 7): the setup checklist is an admin SECTION now, beside «مدرسه‌ها» —
  // one door, and it is inside /admin where the rest of the organization admin's setup work already is.
];

function homeTile(code: string): HomeTile {
  const t = HOME_TILES.find((x) => x.code === code);
  if (!t) throw new Error(`HOME_TILES has no "${code}"`);
  return t;
}

/** An admin SECTION as a hub tile: the section's own label, glyph and href (`src/lib/admin/nav.ts`), gated as /admin is. */
function sectionTile(key: AdminSectionKey): HomeTile {
  const s = ADMIN_SECTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`ADMIN_SECTIONS has no "${key}"`);
  return { code: `admin-${key}`, labelFa: s.labelFa, href: s.href, icon: s.icon, role: "admin", permission: "iam.admin.access" };
}

/**
 * The tiles of the «hub» layout — THE layout since the owner adopted it (2026-09-27, `src/lib/ui-variant.ts`,
 * docs/decisions-pending/home-hub.md, home-hub-tiles.md). The hub has no bottom nav and no rail, so the role item
 * that used to sit at the bottom right — a student's «کلاس من», a teacher's «کلاس‌ها», an admin's «مدیریت» — is
 * gone, and each thing it held is its own Home tile: Home IS the nav, the tiles are the doors. One door per
 * destination still holds per person: every href below is distinct, no person gets two tiles with one label
 * (`altLabelFa`) or one glyph (`altIcon`).
 *
 * Order (owner, 2026-09-27): «پنل من» first; then the student's tiles (the week), the
 * teacher's («کلاس‌های من», the teaching week), the admin's («مدرسه»/«مدرسه‌ها», دانش‌آموزان · کارکنان · کلاس‌ها ·
 * نقش‌ها, «برنامهٴ کلاسی»); «حضور و غیاب» is the LAST tile for every role (the admin's report after the roll call
 * for a person who has both). A multi-hat person gets the union in this order. No «کلاس من» tile (the class card
 * lives on /my-class/info, unlinked from Home) and no «نمای کلی» tile (the /admin overview) — owner, same day.
 * A section-shaped place (the week, «کلاس‌های من», …) opens its own small page that draws that one section of
 * the full page (`/my-class/*`, `/classes/*`); the full pages stay for the classic layout (`HOME_TILES`).
 */
export const HUB_TILES: readonly HomeTile[] = [
  homeTile("inbox"),

  // Student — what «کلاس من» held: the week (the درس list is the «درس‌های من» cards under the tiles).
  {
    code: "my-week",
    labelFa: "برنامهٴ هفتگی",
    href: "/my-class/timetable",
    icon: CalendarDays,
    role: "student",
    // A student who also teaches reads «برنامهٴ هفتگی» as the teaching week below — one tile per label.
    exceptRole: "teacher",
    permission: "academic.timetable.read",
  },
  // No «درس‌ها و دبیران» tile (owner, 2026-09-27): the student's درس‌ها are the «درس‌های من» course cards under the
  // tiles (`HomeCourses`); /my-class/subjects stays for the classic «کلاس من» and direct links.

  // Teacher — what «کلاس‌ها» held: the درس cards and the teaching week. «کلاس‌های من» is the classroom board, as
  // the admin «کلاس‌ها» is; a person who sees both reads their own teaching as the lectern.
  { code: "my-offerings", labelFa: "کلاس‌های من", href: "/classes/offerings", icon: Presentation, altIcon: Lectern, role: "teacher" },
  { code: "teaching-week", labelFa: "برنامهٴ هفتگی", href: "/classes/timetable", icon: CalendarDays, role: "teacher", permission: "academic.timetable.read" },

  // Admin — what «مدیریت» held: the school first, then people and classes, then the bell schedule.
  // «مدرسه‌ها» for EVERY admin scope here: the organization admin's section and a school admin's «مدرسه» tile
  // become the one tile (the one-school rewrite still points a principal at their own school's hub).
  { ...homeTile("schools"), adminScope: undefined },
  sectionTile("students"),
  sectionTile("staff"),
  sectionTile("classes"),
  sectionTile("roles"),
  homeTile("periods"),

  // «حضور و غیاب» last, for every role. The admin's report reads «گزارش حضور و غیاب», on a report glyph, for an
  // admin who also takes or reads a roll call (the teacher/student tile before it keeps the name and the glyph).
  homeTile("attendance"),
  { ...homeTile("admin-attendance"), altLabelFa: "گزارش حضور و غیاب", altIcon: ClipboardList },
];

/** Options of `homeTilesFor`: which layout the viewer runs (`getUiVariant()`); classic when omitted. */
export interface HomeTileOptions {
  variant?: UiVariant;
}

/**
 * The tiles a person with these hats sees, in grid order. `has` answers «holds this permission at any scope?»;
 * a tile with `adminScope` additionally needs the admin hat to reach that far (`hats.adminScope`), and a tile
 * with `oneSchool` is rewritten (or dropped) by whether the admin holds exactly one school. `variant: "hub"`
 * picks the hub layout's list (`HUB_TILES`); anything else is the classic list, exactly as before.
 */
export function homeTilesFor(
  hats: TileHats,
  has: (p: Permission) => boolean,
  opts: HomeTileOptions = {},
): HomeTile[] {
  const wearsOne = (role: TileRole) =>
    (role === "student" && hats.isStudent) ||
    (role === "teacher" && hats.isTeacher) ||
    (role === "admin" && hats.isAdmin);
  const wears = (role: TileAudience) => role === "everyone" || (Array.isArray(role) ? role.some(wearsOne) : wearsOne(role as TileRole));
  const schoolId = hats.singleSchoolId ?? null;
  const list = opts.variant === "hub" ? HUB_TILES : HOME_TILES;
  const shown = list.filter(
    (t) =>
      wears(t.role) &&
      (!t.exceptRole || !wearsOne(t.exceptRole)) &&
      (!t.permission || has(t.permission)) &&
      (!t.adminScope || hats.adminScope === t.adminScope) &&
      (!t.oneSchool?.only || schoolId !== null),
  ).map((t) => {
    return t.oneSchool && schoolId
      ? { ...t, href: t.oneSchool.href(schoolId), ...(t.oneSchool.label ? { labelFa: schoolsLabelFa({ kind: "school", schoolIds: [schoolId] }) } : {}) }
      : t;
  });
  return shown.map((t) => {
    const others = shown.filter((o) => o !== t);
    return {
      ...t,
      ...(t.altLabelFa && others.some((o) => o.labelFa === t.labelFa) ? { labelFa: t.altLabelFa } : {}),
      ...(t.altIcon && others.some((o) => o.icon === t.icon) ? { icon: t.altIcon } : {}),
    };
  });
}

/**
 * Does the hub Home draw its «به‌زودی» section? Hidden for now (owner, 2026-09-27: the «درس‌های من» course cards
 * follow the tiles instead). `upcomingTilesFor` and `UpcomingTiles` stay wired — flip this to `true` to bring the
 * section back; `resolveHomeTiles` (src/components/home/home-data.ts) is the one reader.
 */
export const SHOW_UPCOMING_ON_HOME = false;

/** A grey «به‌زودی» tile of the hub Home: a module that is not built yet — a label and a glyph, never an href. */
export interface UpcomingTile {
  code: string;
  labelFa: string;
  icon: LucideIcon;
}

/**
 * The «به‌زودی» tiles a person with these hats sees on the hub Home, in the product map's order (owner,
 * 2026-09-27): every upcoming module whose `soonFor` names a hat the person wears. They are NOT doors — no href,
 * nothing to open — and they sit in their own section under the live tiles, so live and upcoming never mix.
 * No hat, no tiles. Glyphs come from the product map, so /roadmap and Home draw the same one.
 */
export function upcomingTilesFor(hats: Pick<TileHats, "isStudent" | "isTeacher" | "isAdmin">): UpcomingTile[] {
  const wearsOne = (role: TileRole) =>
    (role === "student" && hats.isStudent) || (role === "teacher" && hats.isTeacher) || (role === "admin" && hats.isAdmin);
  const anyHat = hats.isStudent || hats.isTeacher || hats.isAdmin;
  return UPCOMING_MODULES.filter((m) => {
    const a = m.soonFor;
    if (!a || !anyHat) return false;
    return a === "everyone" || (Array.isArray(a) ? a.some(wearsOne) : wearsOne(a as TileRole));
  }).map((m) => ({ code: m.code, labelFa: m.labelFa, icon: m.icon }));
}
