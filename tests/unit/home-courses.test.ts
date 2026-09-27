// «درس‌های من» — the hub Home's course cards (owner, 2026-09-27, after the university LMS dashboard): one card per
// درس under the tiles — a student's class offerings (the «درس‌ها و دبیران» read), a teacher's own offerings (the hats
// read) — each a whole-surface link into /subjects/[offeringId], topped by a patterned cover in the درس's hue
// (`CourseCover`). A non-teaching admin gets no section. And the «به‌زودی» section is hidden for now
// (`SHOW_UPCOMING_ON_HOME`). The Home reads run for real over mocked queries; the Server Components are rendered to markup.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hats = vi.hoisted(() => ({ value: null as unknown }));
const myClass = vi.hoisted(() => ({ value: null as unknown, calls: 0 }));
vi.mock("@/modules/iam/hats", () => ({ hatsQuery: vi.fn(async () => ({ ok: true, data: hats.value })) }));
vi.mock("@/modules/academic/queries", () => ({
  myClassQuery: vi.fn(async () => {
    myClass.calls++;
    return { ok: true, data: myClass.value };
  }),
  myTimetableQuery: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/modules/workspace/queries", () => ({ homeOpenItemsQuery: vi.fn(async () => ({ ok: true, data: [] })) }));

const { HomeCourses, CourseCards, homeCourses } = await import("@/components/home/HomeCourses");
const { resolveHomeTiles } = await import("@/components/home/home-data");
const { CourseCover, COVER_FAMILIES, COVER_PALETTES, coverFamily } = await import("@/components/illustrations/CourseCover");
const { SHOW_UPCOMING_ON_HOME } = await import("@/lib/modules-registry");
const { subjectHue } = await import("@/lib/subject-stamp");
type Ctx = import("@/lib/ctx").Ctx;

const ctx = { assignments: [{ roleCode: "x", roleId: "r", scopeType: "school", scopeId: "s", permissions: ["workspace.work_item.read"] }] } as unknown as Ctx;
const baseHats = { isStudent: false, studentClass: null, teachingOfferings: [], adminScope: null, adminSingleSchoolId: null };
const STUDENT_CLASS = {
  classGroupName: "۱۰/۱",
  schoolName: "دبیرستان نمونه",
  classmates: 20,
  teachers: [
    { offeringId: "off-math", subjectId: "sub-math", subjectName: "ریاضی ۱", teacherName: "مریم رضایی" },
    { offeringId: "off-phys", subjectId: "sub-phys", subjectName: "فیزیک ۱", teacherName: null },
  ],
};
const TEACHING = [
  { offeringId: "t-1", subjectId: "sub-math", subjectName: "ریاضی ۱", classGroupName: "۱۰/۱", activeStudents: 20, openItems: 2 },
  { offeringId: "t-2", subjectId: "sub-math", subjectName: "ریاضی ۱", classGroupName: "۱۰/۲", activeStudents: 18, openItems: 0 },
];

const render = async () => {
  const el = await HomeCourses({ ctx });
  return el ? renderToStaticMarkup(el) : "";
};
const hrefsOf = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => {
  myClass.value = null;
  myClass.calls = 0;
});

describe("«درس‌های من» on Home", () => {
  it("student: one card per درس of the class, linking to its subject page, the دبیر under the name", async () => {
    hats.value = { ...baseHats, isStudent: true, studentClass: { classGroupName: "۱۰/۱", schoolName: "x" } };
    myClass.value = STUDENT_CLASS;
    const html = await render();
    expect(html).toContain(">درس‌های من</span>");
    expect(hrefsOf(html)).toEqual(["/subjects/off-math", "/subjects/off-phys"]);
    expect(html).toContain("<bdi>ریاضی ۱</bdi>");
    expect(html).toContain("<bdi>مریم رضایی</bdi>");
    expect(html).toContain("دبیر هنوز مشخص نشده");
    // The card: a whole-surface link on the raised white material, clipped round, with the end chevron.
    const link = html.match(/<a [^>]*class="([^"]+)"/)?.[1].split(" ") ?? [];
    for (const c of ["surface-work", "surface-link", "pressable", "rounded-card", "overflow-hidden"]) expect(link).toContain(c);
    expect(html).toContain("lucide-chevron-left");
    // The grid: 2 columns on phones, 3 from md, 4 from lg.
    expect(html).toMatch(/<ul class="[^"]*grid-cols-2[^"]*md:grid-cols-3[^"]*lg:grid-cols-4/);
    // One read of the class (the cached «درس‌ها و دبیران» query), not one per card.
    expect(myClass.calls).toBe(1);
  });

  it("teacher: one card per offering they teach, «کلاس <name>» under the درس — no class read", async () => {
    hats.value = { ...baseHats, teachingOfferings: TEACHING };
    const html = await render();
    expect(hrefsOf(html)).toEqual(["/subjects/t-1", "/subjects/t-2"]);
    expect(html).toContain("کلاس <bdi>۱۰/۱</bdi>");
    expect(html).toContain("کلاس <bdi>۱۰/۲</bdi>");
    expect(myClass.calls).toBe(0);
  });

  it("an admin who does not teach (and studies nowhere) gets no section at all", async () => {
    hats.value = { ...baseHats, adminScope: "organization" };
    expect(await render()).toBe("");
    expect(myClass.calls).toBe(0);
    expect(CourseCards({ courses: [] })).toBeNull();
  });

  it("a person who teaches and studies gets both, teaching first, each offering once", () => {
    const both = homeCourses({ teachingOfferings: TEACHING, myClass: STUDENT_CLASS });
    expect(both.map((c) => [c.offeringId, c.kind])).toEqual([
      ["t-1", "teach"],
      ["t-2", "teach"],
      ["off-math", "study"],
      ["off-phys", "study"],
    ]);
    expect(homeCourses({ teachingOfferings: [], myClass: null })).toEqual([]);
  });
});

describe("CourseCover — the card's patterned cover", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `0192f0a1-0000-7000-8000-${String(i).padStart(12, "0")}`);

  it("is deterministic per subject: same id → the same markup, family and hue", () => {
    for (const id of ids.slice(0, 8)) {
      const a = renderToStaticMarkup(CourseCover({ subjectId: id, name: "شیمی ۲" }));
      const b = renderToStaticMarkup(CourseCover({ subjectId: id, name: "شیمی ۲" }));
      expect(a).toBe(b);
      expect(a).toContain(`data-family="${coverFamily(id)}"`);
      expect(a).toContain(`data-palette="${subjectHue(id)}"`);
    }
  });

  it("`palette` and `variantKey` override the subject's set and pattern; the glyph stays the درس's", () => {
    const subj = ids[0];
    for (let p = 0; p < COVER_PALETTES; p++) {
      const html = renderToStaticMarkup(CourseCover({ subjectId: subj, name: "ریاضی ۱", palette: p, variantKey: `off-${p}` }));
      expect(html).toContain(`data-palette="${p}"`);
      expect(html).toContain(`--cv-0:var(--color-cover-${p}-base)`);
      expect(html).toContain(`data-family="${coverFamily(`off-${p}`)}"`);
      expect(html).toContain("lucide-sigma");
    }
  });

  it("different درس‌ها get different patterns: every family occurs over a spread of ids", () => {
    expect(new Set(ids.map(coverFamily))).toEqual(new Set(COVER_FAMILIES));
    expect(COVER_FAMILIES.length).toBeGreaterThanOrEqual(5);
  });

  it("draws from its own vivid cover palette (not the muted stamps), fills any box, is decorative, and carries the درس's own glyph", () => {
    for (const id of ids.slice(0, 12)) {
      const html = renderToStaticMarkup(CourseCover({ subjectId: id, name: "فیزیک ۱" }));
      const hue = subjectHue(id);
      expect(html).toMatch(/^<div aria-hidden="true"/);
      expect(html).toContain('preserveAspectRatio="xMidYMid slice"');
      expect(html).toContain(`--cv-0:var(--color-cover-${hue}-base)`);
      expect(html).toContain(`--cv-1:var(--color-cover-${hue}-light)`);
      expect(html).toContain(`--cv-3:var(--color-cover-${hue}-dark)`);
      expect(html).toContain(`--cv-ink:var(--color-cover-${hue}-ink)`);
      expect(html).not.toContain("--color-subject-");
      // No raw colour, no raster, no network.
      expect(html.replace(' xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|<image|https?:/i);
      // The glyph of the درس (atom for فیزیک), not a generic one.
      expect(html).toContain("lucide-atom");
    }
  });

  it("globals.css defines the eight vivid cover sets (light / base / dark / ink) in OKLCH, apart from the stamp hues", () => {
    const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
    for (let i = 0; i < COVER_PALETTES; i++) {
      for (const t of ["light", "base", "dark", "ink"]) {
        const m = css.match(new RegExp(`--color-cover-${i}-${t}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\);`));
        expect(m, `cover-${i}-${t}`).not.toBeNull();
        // Vivid, not washed out: the ground and the dark tone carry chroma ≥ 0.09.
        if (t === "base" || t === "dark") expect(Number(m![2])).toBeGreaterThanOrEqual(0.09);
      }
    }
  });
});

describe("course covers across a person's list (owner 2026-09-27)", () => {
  const FIVE_MATH = ["۱۰/۱", "۱۰/۲", "۱۱/۱", "۱۲/۱", "۱۲/۲"].map((cls, i) => ({
    offeringId: `t-math-${i}`,
    subjectId: "sub-math",
    subjectName: "ریاضی ۱",
    classGroupName: cls,
    activeStudents: 20,
    openItems: 0,
  }));

  it("a teacher's five same-subject cards get five distinct colour sets, in order, and each its own pattern seed", () => {
    const cards = homeCourses({ teachingOfferings: FIVE_MATH, myClass: null });
    expect(new Set(cards.map((c) => c.palette)).size).toBe(5);
    const start = subjectHue("sub-math");
    expect(cards.map((c) => c.palette)).toEqual([0, 1, 2, 3, 4].map((k) => (start + k) % COVER_PALETTES));
    expect(cards.map((c) => c.variantKey)).toEqual(FIVE_MATH.map((o) => o.offeringId));
    const html = renderToStaticMarkup(CourseCards({ courses: cards }));
    const drawn = [...html.matchAll(/data-palette="(\d)"/g)].map((m) => m[1]);
    expect(new Set(drawn).size).toBe(5);
    // Every card still carries the درس's own glyph.
    expect(html.match(/lucide-sigma/g)?.length).toBe(5);
  });

  it("neighbours never repeat a colour until all eight are used", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...FIVE_MATH[0], offeringId: `t-${i}`, subjectId: `sub-${i % 3}` }));
    const p = homeCourses({ teachingOfferings: many, myClass: null }).map((c) => c.palette);
    expect(new Set(p.slice(0, 8)).size).toBe(8);
    for (let i = 1; i < p.length; i++) expect(p[i]).not.toBe(p[i - 1]);
  });

  it("a student's cards keep the subject's own set and pattern — one درس, one stable look", () => {
    const cards = homeCourses({ teachingOfferings: [], myClass: STUDENT_CLASS });
    expect(cards.map((c) => c.palette)).toEqual(STUDENT_CLASS.teachers.map((t) => subjectHue(t.subjectId)));
    expect(cards.map((c) => c.variantKey)).toEqual(STUDENT_CLASS.teachers.map((t) => t.subjectId));
    const html = renderToStaticMarkup(CourseCards({ courses: cards }));
    expect(html).toContain(`data-family="${coverFamily("sub-math")}"`);
  });
});

describe("the «به‌زودی» section is hidden for now", () => {
  it("the flag is off and the hub Home reads no upcoming tiles, for any hat", async () => {
    expect(SHOW_UPCOMING_ON_HOME).toBe(false);
    for (const h of [{ isStudent: true }, { teachingOfferings: TEACHING }, { adminScope: "organization" }]) {
      hats.value = { ...baseHats, ...h };
      const home = await resolveHomeTiles(ctx);
      expect(home.variant).toBe("hub");
      expect(home.upcoming).toEqual([]);
    }
  });
});
