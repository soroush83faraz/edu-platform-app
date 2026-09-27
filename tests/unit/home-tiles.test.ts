// The Home tile registry (`homeTilesFor`) under the IA rule (docs/decisions.md «one home per destination»): a
// destination has exactly ONE door — EXCEPT the کارتابل, whose «پنل من» tile (owner, 2026-09-27,
// docs/decisions-pending/nav-home.md) is a second, accepted door alongside the «همهٴ …» link of Home's «تکالیف
// نزدیک» card (`home-inbox-door.test.ts`). Home carries that tile first, then the person's role tiles, then one
// tile per STRUCTURE page, each gated by the permission and scope that guard the page itself. No OTHER tile is a
// second door to a NAV destination — «کلاس من», «کلاس‌ها», «مدیریت», «بیشتر», «خانه» — and no admin SECTION
// («دانش‌آموزان», «کارکنان», «کلاس‌ها», «نقش‌ها») gets one either.
// That is the CLASSIC layout, kept so the switch can be reverted. The «hub» layout (everyone's now, no nav) has its
// own list, `HUB_TILES`, where the tiles ARE the doors — its one-door rules are the «hub layout» block below.
// Plus the pure organization-admin predicate and the nav role.
import { AlarmClock, ClipboardList, Lectern, Presentation, UserCheck } from "lucide-react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SYSTEM_ROLES } from "../../scripts/catalog";
import { HOME_TILES, MODULES, UPCOMING_MODULES, homeTilesFor, showUpcomingOnHome, upcomingTilesFor, type TileHats } from "@/lib/modules-registry";
import { isOrganizationAdmin, navRoleFor, type Assignment } from "@/modules/iam/can";
import type { Permission } from "@/modules/iam/permissions";

const ADMIN_PERMS: Permission[] = [
  "iam.admin.access",
  "tenancy.structure.read",
  "tenancy.structure.write",
  "iam.person.write",
  "academic.attendance.report",
  "workspace.work_item.read",
  "workspace.work_item.create",
];
/** The seeded roles' own permission sets (scripts/catalog.ts) — the vice principal holds the principal's (owner, 2026-09-27). */
const catalogPerms = (code: string): Permission[] => SYSTEM_ROLES.find((r) => r.code === code)?.permissions ?? [];
const PRINCIPAL_PERMS = catalogPerms("school_principal");
const VICE_PERMS = catalogPerms("vice_principal");
/** An admin hat WITHOUT `workspace.work_item.create` and without any structure write — no seeded role is like this any more. */
const READ_ONLY_ADMIN_PERMS: Permission[] = ["iam.admin.access", "tenancy.structure.read", "academic.attendance.report", "workspace.work_item.read"];
const has = (perms: readonly Permission[]) => (p: Permission) => perms.includes(p);
const codes = (tiles: ReturnType<typeof homeTilesFor>) => tiles.map((t) => t.code);
const tile = (tiles: ReturnType<typeof homeTilesFor>, code: string) => tiles.find((t) => t.code === code);

const orgAdmin: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "organization", singleSchoolId: null };
/** A principal of exactly one school; `twoSchools` is the same hat over a scope of two. */
const principal: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "school", singleSchoolId: "s1" };
const twoSchools: TileHats = { ...principal, singleSchoolId: null };
const teacher: TileHats = { isStudent: false, isTeacher: true, isAdmin: false, adminScope: null };
const student: TileHats = { isStudent: true, isTeacher: false, isAdmin: false, adminScope: null };

describe("homeTilesFor", () => {
  it("«پنل من» is a tile again, for every hat that reads work items, and leads the grid (owner, 2026-09-27)", () => {
    expect(HOME_TILES.find((t) => t.code === "inbox")).toMatchObject({ href: "/inbox", labelFa: "پنل من" });
    for (const hats of [orgAdmin, principal, teacher, student]) {
      const tiles = homeTilesFor(hats, has(ADMIN_PERMS));
      expect(codes(tiles)).toContain("inbox");
      expect(codes(tiles)[0]).toBe("inbox");
    }
    // No permission, no tile — and someone with neither a student, teacher nor admin hat (e.g. a guardian) never
    // gets it either, permission or not.
    const noHat: TileHats = { isStudent: false, isTeacher: false, isAdmin: false, adminScope: null };
    expect(codes(homeTilesFor(noHat, has(["workspace.work_item.read"])))).toEqual([]);
    expect(codes(homeTilesFor(student, has([])))).not.toContain("inbox");
  });

  it("the organization admin: the structure tiles the nav gave up, in that order — and no «مدیریت», «مدرسه‌ها» or «راه‌اندازی» tile", () => {
    // No «حضور و غیاب» either (owner, 2026-09-27): attendance is read per school, on each school's hub.
    expect(codes(homeTilesFor(orgAdmin, has(ADMIN_PERMS)))).toEqual(["inbox"]);
    // Round 7: «مدرسه‌ها» (the organization's list) is an admin SECTION for this person, so Home does not carry it —
    // one door. «زنگ‌بندی» has no organization-wide page, so it has no tile either; the fixed catalog (مقطع، پایه،
    // سال) and the retired «تنظیمات زیرساختی» have no door anywhere (2026-09-27).
    expect(tile(homeTilesFor(orgAdmin, has(ADMIN_PERMS)), "schools")).toBeUndefined();
    for (const href of ["/admin/infrastructure", "/admin/years", "/admin/grades", "/admin/levels", "/admin/subjects"]) expect(HOME_TILES.filter((t) => t.href === href)).toEqual([]);
  });

  it("a principal of ONE school gets «مدرسه» and that school's زنگ‌بندی, and no organization catalog", () => {
    const tiles = homeTilesFor(principal, has(ADMIN_PERMS));
    expect(codes(tiles)).toEqual(["inbox", "admin-attendance", "schools", "periods"]);
    expect(tile(tiles, "schools")).toMatchObject({ labelFa: "مدرسه", href: "/admin/schools/s1" });
    expect(tile(tiles, "periods")).toMatchObject({ href: "/admin/schools/s1/periods" });
  });

  it("two schools: «مدرسه‌ها» plural and no زنگ‌بندی tile — a bell schedule belongs to one school", () => {
    const tiles = homeTilesFor(twoSchools, has(ADMIN_PERMS));
    expect(codes(tiles)).toEqual(["inbox", "admin-attendance", "schools"]);
    expect(tile(tiles, "schools")).toMatchObject({ labelFa: "مدرسه‌ها", href: "/admin/schools" });
  });

  it("a vice principal of ONE school gets exactly the principal's tiles — «زنگ‌بندی» of that school included (catalog permissions)", () => {
    const vice = homeTilesFor(principal, has(VICE_PERMS));
    expect(vice).toEqual(homeTilesFor(principal, has(PRINCIPAL_PERMS)));
    expect(codes(vice)).toEqual(["inbox", "admin-attendance", "schools", "periods"]);
    expect(tile(vice, "periods")).toMatchObject({ href: "/admin/schools/s1/periods" });
    // Two schools: the same plural «مدرسه‌ها» and no زنگ‌بندی tile as a principal of two.
    expect(homeTilesFor(twoSchools, has(VICE_PERMS))).toEqual(homeTilesFor(twoSchools, has(PRINCIPAL_PERMS)));
  });

  it("an admin hat without the structure write reads the structure but edits none of it: the roll-call report and «مدرسه»", () => {
    expect(codes(homeTilesFor(principal, has(READ_ONLY_ADMIN_PERMS)))).toEqual(["inbox", "admin-attendance", "schools"]);
  });

  it("«مدرسه‌ها»/«مدرسه» is a tile for SCHOOL-scoped admins only — the organization admin has the section instead", () => {
    // The same permission, the same hat: only the SCOPE decides, so neither person meets the destination twice.
    expect(codes(homeTilesFor(orgAdmin, has(ADMIN_PERMS)))).not.toContain("schools");
    for (const hats of [principal, twoSchools]) expect(codes(homeTilesFor(hats, has(ADMIN_PERMS)))).toContain("schools");
  });

  it("classic: no tile is a second door to a nav destination («خانه», «مدیریت», «کلاس من», «کلاس‌ها», «راهنما», «بیشتر») — the hub layout has no nav, see below", () => {
    // The nav is THREE items — the role item, «خانه», «بیشتر» (owner, nav round 2026-09-27). The کارتابل (/inbox)
    // is no nav cell, but it DOES now have a tile (owner, 2026-09-27) — its second, accepted door alongside the
    // Home card's «همهٴ …» link — so «/inbox» is excluded from this nav-destination check on purpose.
    const navHrefs = ["/home", "/admin", "/my-class", "/classes", "/help", "/more"];
    expect(HOME_TILES.filter((t) => navHrefs.includes(t.href))).toEqual([]);
  });

  it("«اعلان‌ها» is not a tile: it is the bell on Home's greeting row, not a destination of its own", () => {
    expect(HOME_TILES.filter((t) => t.href.startsWith("/notifications"))).toEqual([]);
  });

  it("every tile a person actually sees has a real, unique href: one home per destination", () => {
    for (const hats of [orgAdmin, principal, twoSchools, teacher, student]) {
      const hrefs = homeTilesFor(hats, has(ADMIN_PERMS)).map((t) => t.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const href of hrefs) expect(href.startsWith("/")).toBe(true);
    }
  });

  it("a student's own work now has two doors — the «پنل من» tile and the Home card's «همهٴ تکالیف»; no FILTER tile", () => {
    // «تکالیف من» and «انجام‌شده» left the grid (owner, branding round): both were FILTERS of the کارتابل, and
    // the card's «همهٴ تکالیف» opens it with those very two tabs at the top. Only the plain «پنل من» tile remains.
    expect(codes(homeTilesFor(student, has(["workspace.work_item.read", "academic.timetable.read"])))).toEqual(["inbox"]);
    expect(HOME_TILES.filter((t) => t.href.startsWith("/inbox?tab="))).toEqual([]);
    // Round 2026-09-27 (owner): the creation tile is gone too — a teacher with none of the other tiles'
    // permissions now sees an empty grid; creating stays possible only from the inbox page's own header button.
    expect(codes(homeTilesFor(teacher, has(["workspace.work_item.create", "iam.admin.access", "academic.timetable.read"])))).toEqual([]);
  });

  it("there is no creation tile any more: no «new-item» code and no «/inbox/new» href anywhere in HOME_TILES", () => {
    expect(HOME_TILES.filter((t) => t.code === "new-item")).toEqual([]);
    expect(HOME_TILES.filter((t) => t.href === "/inbox/new")).toEqual([]);
    for (const hats of [orgAdmin, principal, twoSchools, teacher, student]) {
      expect(codes(homeTilesFor(hats, has(ADMIN_PERMS)))).not.toContain("new-item");
    }
  });

  it("a teaching principal reads the school's structure, with no creation tile ahead of it", () => {
    expect(codes(homeTilesFor({ isStudent: false, isTeacher: true, isAdmin: true, adminScope: "school", singleSchoolId: "s1" }, has(ADMIN_PERMS)))).toEqual([
      "inbox",
      "admin-attendance",
      "schools",
      "periods",
    ]);
  });
});

// The «hub» layout — everyone's since the owner adopted it (2026-09-27, src/lib/ui-variant.ts,
// docs/decisions-pending/home-hub.md, home-hub-tiles.md): no bottom nav, no rail — the role item's contents are Home
// tiles, so the tiles ARE the doors. The owner's order: «پنل من» first, then the role tiles, «حضور و غیاب» LAST;
// no «کلاس من» and no «نمای کلی» tile. The one-door rule holds per person (distinct hrefs, labels AND glyphs),
// and the classic list (kept for a revert) stays exactly as above.
describe("homeTilesFor — hub layout", () => {
  const STUDENT_PERMS = catalogPerms("student");
  const TEACHER_PERMS = catalogPerms("teacher");
  const ORG_PERMS = catalogPerms("org_admin");
  const hub = { variant: "hub" } as const;
  const hrefs = (tiles: ReturnType<typeof homeTilesFor>) => tiles.map((t) => t.href);
  const labels = (tiles: ReturnType<typeof homeTilesFor>) => tiles.map((t) => t.labelFa);
  const teachingPrincipal: TileHats = { ...principal, isTeacher: true };
  const teachingStudent: TileHats = { ...student, isTeacher: true };

  it("classic is unchanged and is what no options or the classic variant give (the revert path)", () => {
    for (const hats of [orgAdmin, principal, twoSchools, teacher, student]) {
      for (const perms of [ADMIN_PERMS, PRINCIPAL_PERMS, STUDENT_PERMS, TEACHER_PERMS]) {
        expect(homeTilesFor(hats, has(perms), { variant: "classic" })).toEqual(homeTilesFor(hats, has(perms)));
        expect(homeTilesFor(hats, has(perms), {})).toEqual(homeTilesFor(hats, has(perms)));
      }
    }
    // The hub-only tiles never leak into the classic list.
    const classic = new Set(HOME_TILES.map((t) => t.code));
    for (const code of ["my-week", "my-subjects", "my-offerings", "teaching-week", "admin-students"]) expect(classic.has(code)).toBe(false);
  });

  it("student: پنل من · برنامهٴ هفتگی · حضور و غیاب — no «کلاس من» tile, no «درس‌ها و دبیران» tile (the course cards are)", () => {
    const tiles = homeTilesFor(student, has(STUDENT_PERMS), hub);
    expect(labels(tiles)).toEqual(["پنل من", "برنامهٴ هفتگی", "حضور و غیاب"]);
    expect(hrefs(tiles)).toEqual(["/inbox", "/my-class/timetable", "/attendance"]);
    expect(hrefs(tiles)).not.toContain("/my-class/info");
    // The درس list is the «درس‌های من» cards under the tiles now (owner, 2026-09-27) — for no hat is it a tile.
    for (const [hats, perms] of [
      [student, STUDENT_PERMS],
      [teacher, TEACHER_PERMS],
      [orgAdmin, ORG_PERMS],
      [teachingStudent, [...STUDENT_PERMS, ...TEACHER_PERMS]],
    ] as const) {
      const all = homeTilesFor(hats, has(perms), hub);
      expect(hrefs(all)).not.toContain("/my-class/subjects");
      expect(labels(all)).not.toContain("درس‌ها و دبیران");
    }
  });

  it("teacher: پنل من · کلاس‌های من · برنامهٴ هفتگی · حضور و غیاب", () => {
    const tiles = homeTilesFor(teacher, has(TEACHER_PERMS), hub);
    expect(labels(tiles)).toEqual(["پنل من", "کلاس‌های من", "برنامهٴ هفتگی", "حضور و غیاب"]);
    expect(hrefs(tiles)).toEqual(["/inbox", "/classes/offerings", "/classes/timetable", "/attendance"]);
  });

  it("organization admin: پنل من · مدرسه‌ها · دانش‌آموزان · کارکنان · کلاس‌ها · نقش‌ها — no «نمای کلی», no «حضور و غیاب»", () => {
    const tiles = homeTilesFor(orgAdmin, has(ORG_PERMS), hub);
    expect(labels(tiles)).toEqual(["پنل من", "مدرسه‌ها", "دانش‌آموزان", "کارکنان", "کلاس‌ها", "نقش‌ها"]);
    expect(hrefs(tiles)).toEqual(["/inbox", "/admin/schools", "/admin/students", "/admin/staff", "/admin/classes", "/admin/roles"]);
    // Attendance is per school (owner, 2026-09-27): «مدرسه‌ها» → the school → «حضور و غیاب» (the school hub's door).
    expect(codes(tiles)).not.toContain("admin-attendance");
    expect(codes(homeTilesFor({ ...orgAdmin, isTeacher: true }, has([...ORG_PERMS, ...TEACHER_PERMS]), hub))).not.toContain("admin-attendance");
    // «برنامهٴ کلاسی» belongs to ONE school: the organization admin reaches it through «مدرسه‌ها» → the school.
    expect(codes(tiles)).not.toContain("periods");
    expect(hrefs(tiles)).not.toContain("/admin");
  });

  it("principal of ONE school: پنل من · مدرسه · دانش‌آموزان · کارکنان · کلاس‌ها · نقش‌ها · برنامهٴ کلاسی · حضور و غیاب", () => {
    for (const perms of [PRINCIPAL_PERMS, VICE_PERMS]) {
      const tiles = homeTilesFor(principal, has(perms), hub);
      expect(labels(tiles)).toEqual(["پنل من", "مدرسه", "دانش‌آموزان", "کارکنان", "کلاس‌ها", "نقش‌ها", "برنامهٴ کلاسی", "حضور و غیاب"]);
      expect(tile(tiles, "schools")?.href).toBe("/admin/schools/s1");
      expect(tile(tiles, "periods")?.href).toBe("/admin/schools/s1/periods");
      expect(tile(tiles, "admin-attendance")?.href).toBe("/admin/attendance");
    }
    // Two schools: «مدرسه‌ها» plural, no برنامهٴ کلاسی tile (it belongs to one school) — as in classic.
    const two = homeTilesFor(twoSchools, has(PRINCIPAL_PERMS), hub);
    expect(tile(two, "schools")).toMatchObject({ labelFa: "مدرسه‌ها", href: "/admin/schools" });
    expect(codes(two)).not.toContain("periods");
  });

  it("the admin section tiles need the admin hat's permission, as /admin does", () => {
    const noAccess = ORG_PERMS.filter((p) => p !== "iam.admin.access");
    expect(codes(homeTilesFor(orgAdmin, has(noAccess), hub)).filter((c) => c.startsWith("admin-") && c !== "admin-attendance")).toEqual([]);
  });

  it("«حضور و غیاب» is the LAST tile for every role that has one on Home (not the organization admin)", () => {
    for (const [hats, perms] of [
      [student, STUDENT_PERMS],
      [teacher, TEACHER_PERMS],
      [principal, PRINCIPAL_PERMS],
      [twoSchools, VICE_PERMS],
    ] as const) {
      expect(labels(homeTilesFor(hats, has(perms), hub)).at(-1)).toBe("حضور و غیاب");
    }
  });

  it("multi-hat people get the union in the same relative order, de-duplicated, attendance last", () => {
    const tp = homeTilesFor(teachingPrincipal, has([...PRINCIPAL_PERMS, ...TEACHER_PERMS]), hub);
    expect(labels(tp)).toEqual([
      "پنل من",
      "کلاس‌های من",
      "برنامهٴ هفتگی",
      "مدرسه",
      "دانش‌آموزان",
      "کارکنان",
      "کلاس‌ها",
      "نقش‌ها",
      "برنامهٴ کلاسی",
      "حضور و غیاب",
      "گزارش حضور و غیاب",
    ]);
    // Two «حضور و غیاب» destinations for one person: the roll call keeps the name, the report says what it is.
    expect(tile(tp, "attendance")?.href).toBe("/attendance");
    expect(tile(tp, "admin-attendance")?.href).toBe("/admin/attendance");
    // A plain admin keeps «حضور و غیاب» for the report — the other tile is not theirs.
    expect(tile(homeTilesFor(principal, has(PRINCIPAL_PERMS), hub), "admin-attendance")?.labelFa).toBe("حضور و غیاب");
    // A student who also teaches: «برنامهٴ هفتگی» is the teaching week; the class week steps aside (one label, one tile).
    const both = homeTilesFor(teachingStudent, has([...STUDENT_PERMS, ...TEACHER_PERMS]), hub);
    expect(codes(both)).toEqual(["inbox", "my-offerings", "teaching-week", "attendance"]);
  });

  it("the glyphs: a bell-schedule clock for «برنامهٴ کلاسی», the classroom board for «کلاس‌ها», a person's own teaching on the lectern beside it", () => {
    const one = homeTilesFor(principal, has(PRINCIPAL_PERMS), hub);
    expect(tile(one, "periods")?.icon).toBe(AlarmClock);
    expect(tile(one, "admin-classes")?.icon).toBe(Presentation);
    expect(tile(homeTilesFor(teacher, has(TEACHER_PERMS), hub), "my-offerings")?.icon).toBe(Presentation);
    // A teaching principal sees both «کلاس» tiles and both attendance tiles: each pair on two different glyphs.
    const tp = homeTilesFor(teachingPrincipal, has([...PRINCIPAL_PERMS, ...TEACHER_PERMS]), hub);
    expect(tile(tp, "admin-classes")?.icon).toBe(Presentation);
    expect(tile(tp, "my-offerings")?.icon).toBe(Lectern);
    expect(tile(tp, "attendance")?.icon).toBe(UserCheck);
    expect(tile(tp, "admin-attendance")?.icon).toBe(ClipboardList);
    // Alone, the admin's report keeps the attendance glyph every other role sees.
    expect(tile(one, "admin-attendance")?.icon).toBe(UserCheck);
  });

  it("one door per destination, per person: every hub tile a person sees has a real, unique href, label and glyph", () => {
    const personas: [TileHats, Permission[]][] = [
      [student, STUDENT_PERMS],
      [teacher, TEACHER_PERMS],
      [orgAdmin, ORG_PERMS],
      [principal, PRINCIPAL_PERMS],
      [twoSchools, VICE_PERMS],
      [teachingPrincipal, [...PRINCIPAL_PERMS, ...TEACHER_PERMS]],
      [teachingStudent, [...STUDENT_PERMS, ...TEACHER_PERMS]],
      [{ ...orgAdmin, isTeacher: true, isStudent: true }, [...ORG_PERMS, ...TEACHER_PERMS, ...STUDENT_PERMS]],
    ];
    for (const [hats, perms] of personas) {
      const tiles = homeTilesFor(hats, has(perms), hub);
      expect(new Set(hrefs(tiles)).size).toBe(tiles.length);
      expect(new Set(labels(tiles)).size).toBe(tiles.length);
      expect(new Set(tiles.map((t) => t.icon)).size).toBe(tiles.length);
      for (const href of hrefs(tiles)) expect(href.startsWith("/")).toBe(true);
    }
  });

  it("there is no nav in hub mode, so the tiles carry the places the role item held", () => {
    // The student's درس list is not a tile any more: the «درس‌های من» course cards under the tiles open each درس.
    expect(hrefs(homeTilesFor(student, has(STUDENT_PERMS), hub))).toEqual(expect.arrayContaining(["/my-class/timetable"]));
    expect(hrefs(homeTilesFor(teacher, has(TEACHER_PERMS), hub))).toEqual(expect.arrayContaining(["/classes/offerings", "/classes/timetable"]));
    for (const route of ["my-class/timetable", "my-class/subjects", "my-class/info", "classes/offerings", "classes/timetable"]) {
      const src = readFileSync(new URL(`../../src/app/(app)/${route}/page.tsx`, import.meta.url), "utf8");
      // Each is an inner page reached from Home: the layout primitives and the way back.
      expect(src).toContain("<ContentWidth");
      expect(src).toContain('back={{ href: "/home", label: "خانه" }}');
    }
    // And the full pages keep drawing those same parts (no duplicated markup between the layouts).
    expect(readFileSync(new URL("../../src/app/(app)/my-class/page.tsx", import.meta.url), "utf8")).toContain("<MySubjectsList");
    expect(readFileSync(new URL("../../src/app/(app)/classes/page.tsx", import.meta.url), "utf8")).toContain("<OfferingsGrid");
  });
});

describe("isOrganizationAdmin", () => {
  const a = (scopeType: Assignment["scopeType"], permissions: string[]): Assignment => ({ roleCode: "x", roleId: "r", scopeType, scopeId: "s", permissions });
  it("true only for an ORGANIZATION-scoped assignment that carries iam.admin.access", () => {
    expect(isOrganizationAdmin([a("organization", ["iam.admin.access"])])).toBe(true);
    expect(isOrganizationAdmin([a("school", ["iam.admin.access"]), a("branch", ["iam.admin.access"])])).toBe(false);
    expect(isOrganizationAdmin([a("organization", ["workspace.work_item.read"])])).toBe(false);
    expect(isOrganizationAdmin([])).toBe(false);
  });
});

describe("navRoleFor", () => {
  const r = (roleCode: string, scopeType: Assignment["scopeType"], permissions: string[] = []): Assignment => ({ roleCode, roleId: "r", scopeType, scopeId: "s", permissions });
  const student = r("student", "student");
  const teacher = r("teacher", "class_offering", ["workspace.work_item.create"]);
  const principal = r("school_principal", "school", ["iam.admin.access"]);

  it("one hat → that hat", () => {
    expect(navRoleFor([student])).toBe("student");
    expect(navRoleFor([teacher, teacher])).toBe("teacher");
    expect(navRoleFor([principal])).toBe("admin");
    expect(navRoleFor([r("org_admin", "organization", ["iam.admin.access"])])).toBe("admin");
  });

  it("several hats → the highest of admin > teacher > student", () => {
    expect(navRoleFor([student, teacher])).toBe("teacher");
    expect(navRoleFor([teacher, principal])).toBe("admin");
    expect(navRoleFor([student, principal])).toBe("admin");
  });

  it("the admin hat is the permission, not the role name; no hat → null", () => {
    expect(navRoleFor([r("vice_principal", "branch", ["iam.admin.access"])])).toBe("admin");
    expect(navRoleFor([r("guardian_full", "family")])).toBeNull();
    expect(navRoleFor([])).toBeNull();
  });
});

describe("product map", () => {
  it("«تکالیف» is delivered (phase 1) and no longer «به‌زودی»; «برنامهٴ هفتگی» likewise", () => {
    expect(MODULES.find((m) => m.code === "homework")?.phase).toBe(1);
    expect(MODULES.find((m) => m.code === "class-schedule")?.phase).toBe(1);
    expect(UPCOMING_MODULES.map((m) => m.code)).not.toContain("homework");
    expect(UPCOMING_MODULES.map((m) => m.code)).not.toContain("class-schedule");
    expect(UPCOMING_MODULES.every((m) => m.phase > 1)).toBe(true);
  });

  it("no Home DOOR points at the roadmap: the «به‌زودی» tiles are not links (owner, 2026-09-27)", () => {
    // What each coming module will do is read on «بیشتر ← نقشهٴ راه»; Home shows the modules, never a door to them.
    expect(HOME_TILES.filter((t) => t.href.startsWith("/roadmap"))).toEqual([]);
    for (const file of ["HomeGrid.tsx", "dashboard/DashboardTiles.tsx", "UpcomingTiles.tsx"]) {
      const src = readFileSync(new URL(`../../src/components/home/${file}`, import.meta.url), "utf8");
      expect(src).not.toContain("/roadmap");
    }
    const soon = readFileSync(new URL("../../src/components/home/UpcomingTiles.tsx", import.meta.url), "utf8");
    expect(soon).not.toMatch(/next\/link|<Link|<a |href=/);
  });

  it("«حضور و غیاب» is delivered too, and its ONE tile serves both the student and the teacher", () => {
    expect(MODULES.find((m) => m.code === "attendance")?.phase).toBe(1);
    expect(MODULES.find((m) => m.code === "attendance")?.href).toBe("/attendance");
    expect(UPCOMING_MODULES.map((m) => m.code)).not.toContain("attendance");
    // One destination, one tile (the IA rule) — even though two hats reach it.
    expect(HOME_TILES.filter((t) => t.href === "/attendance")).toHaveLength(1);
    const withAttendance: Permission[] = [...ADMIN_PERMS, "academic.attendance.read"];
    expect(codes(homeTilesFor(student, has(withAttendance)))).toContain("attendance");
    expect(codes(homeTilesFor(teacher, has(withAttendance)))).toContain("attendance");
    // A school admin who neither teaches nor studies reads the REPORT instead — a different page with its own tile;
    // the organization admin reads it per school, from the school hub, so neither tile is theirs.
    expect(codes(homeTilesFor(principal, has(withAttendance)))).not.toContain("attendance");
    expect(codes(homeTilesFor(principal, has(withAttendance)))).toContain("admin-attendance");
    expect(codes(homeTilesFor(orgAdmin, has(withAttendance)))).not.toContain("attendance");
    expect(codes(homeTilesFor(orgAdmin, has(withAttendance)))).not.toContain("admin-attendance");
    expect(HOME_TILES.filter((t) => t.href === "/admin/attendance")).toHaveLength(1);
    // Without the permission (a role that never sees attendance) the tile disappears.
    expect(codes(homeTilesFor(student, has(ADMIN_PERMS)))).not.toContain("attendance");
  });
});


// The hub Home's «به‌زودی» section (owner, 2026-09-27): the modules the product map lists as coming, as grey tiles
// under the live ones — per role (`soonFor`), with a glyph of their own, and never a door.
describe("showUpcomingOnHome (owner, 2026-09-27)", () => {
  it("every admin's Home draws «به‌زودی» — organization admin, principal, vice principal, even when they also teach; teachers and students do not", () => {
    for (const hats of [orgAdmin, { ...orgAdmin, isTeacher: true }, principal, twoSchools, { ...principal, isTeacher: true }]) expect(showUpcomingOnHome(hats)).toBe(true);
    for (const hats of [teacher, student]) expect(showUpcomingOnHome(hats)).toBe(false);
  });
});

describe("upcomingTilesFor", () => {
  const soon = (hats: TileHats) => upcomingTilesFor(hats).map((t) => t.labelFa);

  it("student, teacher and admin each see the modules they will use, in the product map's order", () => {
    expect(soon(student)).toEqual([
      "تابلو اعلانات",
      "درخواست‌ها",
      "آزمون",
      "برنامهٴ امتحانی",
      "محتوای آموزشی",
      "پیام‌ها",
      "مشاوره",
      "کیف امتیازی",
      "اعتراض نمره",
      "حساب مالی",
      "جلسات آنلاین",
    ]);
    expect(soon(teacher)).toEqual([
      "دفتر کلاسی",
      "موارد انضباطی",
      "تابلو اعلانات",
      "گزارش‌ها",
      "درخواست‌ها",
      "آزمون",
      "برنامهٴ امتحانی",
      "محتوای آموزشی",
      "پیام‌ها",
      "کیف امتیازی",
      "اعتراض نمره",
      "جلسات آنلاین",
    ]);
    for (const admin of [orgAdmin, principal]) {
      expect(soon(admin)).toEqual([
        "دفتر کلاسی",
        "موارد انضباطی",
        "والدین",
        "تابلو اعلانات",
        "گزارش‌ها",
        "درخواست‌ها",
        "برنامهٴ امتحانی",
        "پیام‌ها",
        "مشاوره",
        "حساب مالی",
      ]);
    }
  });

  it("a person with several hats gets the union once; no hat, no tiles", () => {
    const all = upcomingTilesFor({ isStudent: true, isTeacher: true, isAdmin: true });
    expect(all.map((t) => t.code)).toEqual(UPCOMING_MODULES.map((m) => m.code));
    expect(upcomingTilesFor({ isStudent: false, isTeacher: false, isAdmin: false })).toEqual([]);
  });

  it("only upcoming modules, each with a distinct glyph that no live hub tile of that person draws — and no href", () => {
    const live = new Set(MODULES.filter((m) => m.phase === 1).map((m) => m.code));
    const personas: [TileHats, Permission[]][] = [
      [student, catalogPerms("student")],
      [teacher, catalogPerms("teacher")],
      [orgAdmin, catalogPerms("org_admin")],
      [principal, PRINCIPAL_PERMS],
    ];
    for (const [hats, perms] of personas) {
      const up = upcomingTilesFor(hats);
      for (const t of up) {
        expect(live.has(t.code)).toBe(false);
        expect(t).not.toHaveProperty("href");
      }
      const liveIcons = new Set(homeTilesFor(hats, has(perms), { variant: "hub" }).map((t) => t.icon));
      expect(new Set(up.map((t) => t.icon)).size).toBe(up.length);
      for (const t of up) expect(liveIcons.has(t.icon)).toBe(false);
    }
  });
});
