// The branding round: the product is «دانینو», and the emblem that used to stand for the school now says which
// KIND OF ACCOUNT you are signed in as. Two things are pinned here — the product name default (everything else
// reads it) and the role→glyph/label mapping, a pure function of the session's assignments (no query).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { DoninoMark, DoninoWordmark } from "@/components/brand/DoninoMark";
import { RoleMark } from "@/components/brand/RoleMark";
import { ROLE_LABELS, ROLE_ORDER, type RoleHatSource, type RoleKey, roleHatsFor, roleHatsLabel } from "@/components/brand/roles";
import { SplashScreen } from "@/components/brand/SplashScreen";
import { MARK_BOTTOM, MARK_GHOST_OPACITY, MARK_TOP, MONOGRAM_PATH, MONOGRAM_STROKES, ghostMarkSvg, markSvg } from "@/lib/brand/mark";
import { DEFAULT_PRODUCT_NAME, productName } from "@/lib/product";

const ADMIN = "iam.admin.access";
const a = (roleCode: string, scopeType: RoleHatSource["scopeType"], permissions: string[] = []): RoleHatSource => ({ roleCode, scopeType, permissions });

describe("the product is «دانینو»", () => {
  const before = process.env.PRODUCT_NAME;
  afterEach(() => {
    if (before === undefined) delete process.env.PRODUCT_NAME;
    else process.env.PRODUCT_NAME = before;
  });

  it("defaults to «دانینو» — never the category «سامانهٴ مدرسه», never the competitor", () => {
    delete process.env.PRODUCT_NAME;
    expect(DEFAULT_PRODUCT_NAME).toBe("دانینو");
    expect(productName()).toBe("دانینو");
    expect(DEFAULT_PRODUCT_NAME).not.toContain("همکلاسی");
  });

  it("the PRODUCT_NAME override still wins, and an empty one falls back", () => {
    process.env.PRODUCT_NAME = "مدرسهٴ نمونه";
    expect(productName()).toBe("مدرسهٴ نمونه");
    process.env.PRODUCT_NAME = "   ";
    expect(productName()).toBe(DEFAULT_PRODUCT_NAME);
  });
});

describe("the brand mark — the owner's «D» monogram", () => {
  it("is one geometry in two renderings: the JSX component and the satori SVG string", () => {
    const jsx = renderToStaticMarkup(createElement(DoninoMark, { size: 40 }));
    const svg = markSvg();
    for (const html of [jsx, svg]) expect(html).toContain(MONOGRAM_PATH);
    // No external asset; the UI rendering inherits its colour instead of carrying a hex.
    expect(jsx).not.toContain("<img");
    expect(jsx).toContain('viewBox="0 0 64 64"');
    expect(jsx).toContain('fill="currentColor"');
    expect(jsx).toContain("text-primary-700");
    expect(jsx).not.toContain("#");
    // The icon is the same monogram in white on the clay material's two stops.
    expect(svg.toUpperCase()).toContain(MARK_TOP);
    expect(svg.toUpperCase()).toContain(MARK_BOTTOM);
  });

  it("is the owner's logo redrawn: two even-odd contours of one constant-width ribbon", () => {
    // 1 the silhouette (with the notch that runs up into the inner eye) · 2 the channel round the inner D.
    const subpaths = MONOGRAM_PATH.split(/(?=M)/).map((d) => d.trim());
    expect(subpaths).toHaveLength(2);
    expect(MONOGRAM_STROKES).toEqual(subpaths);
    expect(renderToStaticMarkup(createElement(DoninoMark, {}))).toContain('fill-rule="evenodd"');
    expect(markSvg()).toContain('fill-rule="evenodd"');
    // The stem, the bars and the bowls sit on exact numbers: stem 5.75, top 5, bottom 59, bowl r = 27 about
    // (32, 32) — straight edges truly straight, the bowl a true circle (its quarter ends at 59 32).
    expect(subpaths[0]).toMatch(/^M5\.75 5H32C.* 59 32C.* 32 59H5\.75C/);
    // One stroke (5.75) inside: the channel opens at the stem's inner edge under the top bar and runs round r = 21.25.
    expect(subpaths[1]).toMatch(/^M11\.5 10\.75H32C.* 53\.25 32C.* 32 53\.25H/);
    // The inner D: its eye (r = 10.6) and its outer edge (r = 16.35), level top and bottom about the same centre.
    expect(subpaths[0]).toContain("H32C37.85 42.6 42.6 37.85 42.6 32");
    expect(subpaths[1]).toContain("H32C41.03 48.35 48.35 41.03 48.35 32");
    for (const d of subpaths) expect(d.endsWith("Z")).toBe(true);
    // Few nodes: 11 on-curve points per contour (the auto-trace had 30 in all).
    for (const d of subpaths) expect(d.match(/[MHLC]/g)).toHaveLength(11);
  });

  it("the iOS launch still is the same monogram, pale on the page ground — the splash's first frame", () => {
    const ghost = ghostMarkSvg();
    expect(ghost).toContain(MONOGRAM_PATH);
    expect(ghost).toContain('viewBox="0 0 64 64"');
    expect(ghost).toContain(`fill-opacity="${MARK_GHOST_OPACITY}"`);
    expect(ghost).not.toContain("url(#g)");
    const splash = renderToStaticMarkup(createElement(SplashScreen));
    expect(splash).toContain(MONOGRAM_PATH);
    expect(splash).toContain(`fill-opacity="${MARK_GHOST_OPACITY}"`);
    // Two pen strokes, one per contour, each normalised to a path length of 1.
    expect(splash.match(/pathLength="1"/g)).toHaveLength(2);
    // The ripple: one pool and four wavefronts behind the mark, the only things on the ground — five layers at most.
    expect(splash.match(/class="splash-ripple/g)).toHaveLength(4);
    expect(splash.match(/class="splash-wash"/g)).toHaveLength(1);
    // The water: one canvas, drawn by the second inline script (after the boot script).
    expect(splash.match(/<canvas class="splash-water"/g)).toHaveLength(1);
    expect(splash.match(/<script/g)).toHaveLength(2);
    // Pure SVG + CSS: no image, no video, no gradient, no filter.
    for (const banned of ["<img", "<video", "Gradient", "filter"]) expect(splash).not.toContain(banned);
  });

  it("the maskable icon keeps the mark inside the 80% safe zone and squares its corners", () => {
    const maskable = markSvg(true);
    expect(maskable).toContain('viewBox="-8 -8 80 80"');
    expect(maskable).not.toContain("rx=");
    expect(markSvg(false)).toContain('rx="16.64"');
  });

  it("the wordmark puts the name beside the mark — Persian by default, «donino» only when asked", () => {
    const fa = renderToStaticMarkup(createElement(DoninoWordmark, { name: "دانینو", size: 32 }));
    expect(fa).toContain("دانینو");
    expect(fa).toContain(MONOGRAM_PATH);
    expect(fa).not.toContain("donino");
    const latin = renderToStaticMarkup(createElement(DoninoWordmark, { script: "latin" as const }));
    expect(latin).toContain("donino");
    expect(latin).toContain('dir="ltr"');
  });
});

describe("roleHatsFor — the hats the emblem speaks for", () => {
  it("names each hat from its role assignment", () => {
    expect(roleHatsFor([a("org_admin", "organization", [ADMIN])])).toEqual(["org_admin"]);
    expect(roleHatsFor([a("school_principal", "school", [ADMIN])])).toEqual(["principal"]);
    expect(roleHatsFor([a("vice_principal", "school", [ADMIN])])).toEqual(["vice"]);
    expect(roleHatsFor([a("teacher", "class_offering", ["workspace.work_item.read"])])).toEqual(["teacher"]);
    expect(roleHatsFor([a("student", "student", ["iam.account.self"])])).toEqual(["student"]);
    expect(roleHatsFor([a("guardian", "family", [])])).toEqual(["guardian"]);
    expect(roleHatsFor([])).toEqual([]);
  });

  it("«مدیر سازمان» is the ORGANIZATION-scoped admin — a school-scoped one is «مدیر مدرسه»", () => {
    // The same rule as `isOrganizationAdmin`: the scope decides, not the role code.
    expect(roleHatsFor([a("custom_admin", "organization", [ADMIN])])).toEqual(["org_admin"]);
    expect(roleHatsFor([a("custom_admin", "school", [ADMIN])])).toEqual(["principal"]);
    expect(roleHatsFor([a("custom_admin", "branch", [ADMIN])])).toEqual(["principal"]);
    // A narrow assignment WITHOUT admin access is no admin hat at all.
    expect(roleHatsFor([a("counselor", "school", ["workspace.work_item.read"])])).toEqual([]);
  });

  it("a multi-hat person is introduced by the highest hat, the rest follow in order", () => {
    const hats = roleHatsFor([a("teacher", "class_offering", []), a("school_principal", "school", [ADMIN]), a("student", "student", [])]);
    expect(hats).toEqual(["principal", "teacher", "student"]);
    expect(roleHatsLabel(hats)).toBe("مدیر مدرسه · دبیر · دانش‌آموز");
    // admin > teacher > student, whatever order the assignments arrive in.
    expect(roleHatsFor([a("student", "student", []), a("org_admin", "organization", [ADMIN])])[0]).toBe("org_admin");
    // The same hat twice (two offerings, two schools) is still one hat.
    expect(roleHatsFor([a("teacher", "class_offering", []), a("teacher", "class_offering", [])])).toEqual(["teacher"]);
  });

  it("ROLE_ORDER is the whole mapping, highest first, and every hat has a Persian label", () => {
    expect(ROLE_ORDER).toEqual(["org_admin", "principal", "vice", "teacher", "student", "guardian"]);
    expect(ROLE_ORDER.map((k) => ROLE_LABELS[k])).toEqual(["مدیر سازمان", "مدیر مدرسه", "معاون", "دبیر", "دانش‌آموز", "ولی"]);
  });
});

describe("RoleMark — the school emblem, wearing the hat's glyph", () => {
  const render = (hats: readonly RoleKey[], tone?: "header" | "plate" | "line") => renderToStaticMarkup(createElement(RoleMark, { hats, tone }));

  it("is the app header's 32 px hero square — exactly the markup the school mark had", () => {
    const html = render(["principal"]);
    expect(html).toContain("size-8");
    expect(html).toContain("rounded-xl");
    expect(html).toContain("bg-hero");
    // No new icon material, no ring, no chip, no visible text.
    expect(html).not.toContain("clay-icon");
    expect(html).not.toContain("outline-");
    expect(html).not.toContain("مدیر مدرسه<");
  });

  it("on the hero banner it keeps the white plate the clay school mark sat on", () => {
    const html = render(["student"], "plate");
    expect(html).toContain("size-13");
    expect(html).toContain("bg-surface");
    expect(html).toContain("text-primary-600");
  });

  it("on the desktop rail it is the quiet line mark under the «دانینو» wordmark — never a second blue square", () => {
    const html = render(["teacher"], "line");
    expect(html).toContain("size-6");
    expect(html).toContain("bg-surface-sunken");
    expect(html).not.toContain("bg-hero");
  });

  it("carries one distinct glyph per hat — the ONLY thing that differs between roles", () => {
    const glyphs = ROLE_ORDER.map((key) => [...render([key]).matchAll(/<(?:path|circle|rect|line|polyline|polygon)[^>]*>/g)].join(""));
    expect(new Set(glyphs).size).toBe(ROLE_ORDER.length);
  });

  it("names the role for a screen reader and in the tooltip; a second hat rides along", () => {
    const one = render(["vice"]);
    expect(one).toContain('aria-label="معاون"');
    expect(one).toContain('title="معاون"');
    expect(one).toContain('role="img"');
    const two = render(["principal", "teacher"]);
    expect(two).toContain('aria-label="مدیر مدرسه · دبیر"');
    expect(render(["vice"], "plate")).toContain('title="معاون"');
  });

  it("renders nothing with no hat — the caller keeps the mark it had", () => {
    expect(render([])).toBe("");
    expect(render([], "plate")).toBe("");
  });
});
