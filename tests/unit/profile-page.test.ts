// «حساب من» — the account page the hub top bar's profile icon opens (/more; owner, 2026-09-27: «remove the «بیشتر»
// title, make it prettier»). The page is rendered statically with its reads mocked and inspected as a string:
// no visible «بیشتر» heading (the title «حساب من» is for assistive tech and the tab only), the blue profile card
// (name, hats, school / organization, login identifier), the titled groups of rows and «خروج» apart at the bottom.
// `PageHeader` (async, tested in hub-shell.test.ts) is stubbed with a sync header that records its props.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Assignment = { roleCode: string; roleId: string; scopeType: string; scopeId: string; permissions: string[] };
const state = vi.hoisted(() => ({
  ctx: { firstName: "سارا", lastName: "احمدی", orgName: "سازمان نمونه", schoolName: "دبستان نمونه" as string | null, assignments: [] as Assignment[] },
  login: "+989351001000" as string | null,
  header: null as Record<string, unknown> | null,
  shell: { orgScoped: false, orgName: "سازمان نمونه", schoolName: "دبستان نمونه" as string | null, yearName: null, termName: null, schools: [] as { id: string; name: string }[] },
}));
vi.mock("@/lib/shell-context", () => ({ getShellContext: async () => state.shell }));
vi.mock("@/lib/ctx", () => ({ requireContext: async () => state.ctx }));
vi.mock("@/lib/profile-queries", () => ({ myLoginIdentifierQuery: async () => ({ ok: true, data: state.login }) }));
vi.mock("@/modules/iam/actions", () => ({ logoutAction: async () => undefined as never }));
vi.mock("@/components/layout/PageHeader", async () => {
  const { createElement: h } = await import("react");
  return {
    PageHeader: (props: Record<string, unknown>) => {
      state.header = props;
      return h("header", { "data-page-header": "" }, h("h2", { className: props.hideTitle ? "sr-only" : "" }, props.title as string));
    },
  };
});

const { default: MorePage, metadata } = await import("@/app/(app)/more/page");
const { ProfileCard } = await import("@/components/profile/ProfileCard");

const ADMIN = "iam.admin.access";
const a = (roleCode: string, scopeType: string, permissions: string[] = []): Assignment => ({ roleCode, roleId: "r", scopeType, scopeId: "s", permissions });

async function page() {
  return renderToStaticMarkup(await MorePage());
}
/** The markup of the profile card (the first <section aria-label="نمایهٴ من">). */
const card = (html: string) => html.slice(html.indexOf('<section aria-label="نمایهٴ من"'), html.indexOf("</section>") + 10);
const text = (html: string) => html.replace(/<[^>]+>/g, "");

beforeEach(() => {
  state.ctx = { firstName: "سارا", lastName: "احمدی", orgName: "سازمان نمونه", schoolName: "دبستان نمونه", assignments: [a("student", "student")] };
  state.login = "+989351001000";
  state.header = null;
  state.shell = { orgScoped: false, orgName: "سازمان نمونه", schoolName: "دبستان نمونه", yearName: null, termName: null, schools: [] };
});

describe("«حساب من» (/more)", () => {
  it("has no «بیشتر» title: the document title and the (screen-reader-only) heading are «حساب من», with the default «خانه» back", async () => {
    expect(metadata.title).toBe("حساب من");
    const html = await page();
    expect(text(html)).not.toContain("بیشتر");
    expect(state.header).toMatchObject({ title: "حساب من", hideTitle: true });
    expect(state.header?.back).toBeUndefined(); // PageHeader's hub default: the «خانه» link to /home
    expect(html).toContain('<h2 class="sr-only">حساب من</h2>');
  });

  it("the profile card: the blue brand card with the avatar, the full name, the hat, the school and the phone", async () => {
    const html = card(await page());
    for (const c of ["bg-hero", "rounded-hero", "text-white", "overflow-hidden"]) expect(html).toContain(c);
    expect(html).toContain("lucide-user-round"); // the avatar glyph
    expect(html).toContain('<p class="text-title font-bold text-white"><bdi>سارا احمدی</bdi></p>');
    expect(html).toContain(">دانش‌آموز</li>");
    expect(html).toContain("دبستان نمونه");
    expect(html).toMatch(/<bdi dir="ltr" class="tabular truncate">[۰-۹ ]+<\/bdi>/); // Persian digits, LTR
    expect(html).toContain("نام‌کاربری:");
    expect(html).toContain("<circle"); // the faint water rings of the greeting card
    // Every text line pure white (contrast ≥ 4.5:1 on the gradient); only the decorative mark is faint.
    expect(html.match(/<(p|li|span|bdi|div)\b[^>]*class="[^"]*text-white\/\d/g)).toBeNull();
  });

  it("hats: a principal who teaches three offerings reads «مدیر مدرسه» and «دبیر · ۳ درس»", async () => {
    state.ctx.assignments = [a("school_principal", "school", [ADMIN]), a("teacher", "class_offering"), a("teacher", "class_offering"), a("teacher", "class_offering")];
    const html = card(await page());
    expect(html.indexOf(">مدیر مدرسه</li>")).toBeGreaterThan(-1);
    expect(html.indexOf(">دبیر · ۳ درس</li>")).toBeGreaterThan(html.indexOf(">مدیر مدرسه</li>"));
  });

  it("the organization admin is introduced by the organization; a username login stays as typed", async () => {
    state.ctx.assignments = [a("org_admin", "organization", [ADMIN])];
    state.login = "admin.demo";
    const html = card(await page());
    expect(html).toContain(">مدیر سازمان</li>");
    expect(html).toContain("سازمان نمونه");
    expect(html).not.toContain("دبستان نمونه");
    expect(html).toContain(">admin.demo</bdi>");
  });

  it("the organization admin who also teaches, in a one-school organization: still the organization, never the school", async () => {
    state.ctx.assignments = [a("org_admin", "organization", [ADMIN]), a("teacher", "class_offering")];
    state.shell = { ...state.shell, orgScoped: true, schoolName: null };
    const html = card(await page());
    expect(html).toContain("سازمان نمونه");
    expect(html).not.toContain("دبستان نمونه");
  });

  it("a principal is introduced by THEIR school (the shell's scope school), not the organization's primary one", async () => {
    state.ctx.assignments = [a("school_principal", "school", [ADMIN])];
    state.shell = { ...state.shell, schoolName: "دبیرستان دوم" };
    const html = card(await page());
    expect(html).toContain("دبیرستان دوم");
    expect(html).not.toContain("دبستان نمونه");
    expect(html).not.toContain("سازمان نمونه");
  });

  it("no hat: «عضو»; no login identifier: no identifier line", () => {
    const html = renderToStaticMarkup(createElement(ProfileCard, { firstName: "سارا", lastName: "احمدی", hats: [], teaching: 0, place: "دبستان نمونه", loginIdentifier: null }));
    expect(html).toContain(">عضو</li>");
    expect(html).not.toContain("نام‌کاربری:");
  });

  it("the rows in titled groups — «حساب کاربری», «راهنما و اطلاعات» — each one work card of whole-row links", async () => {
    const html = await page();
    const account = html.indexOf(">حساب کاربری</span>");
    const info = html.indexOf(">راهنما و اطلاعات</span>");
    expect(account).toBeGreaterThan(-1);
    expect(info).toBeGreaterThan(account);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/change-password", "/help", "/privacy", "/roadmap"]);
    expect(html.indexOf('href="/change-password"')).toBeGreaterThan(account);
    expect(html.indexOf('href="/change-password"')).toBeLessThan(info);
    expect(html.match(/class="surface-work"/g)?.length).toBe(3); // two groups + the logout card
    expect(html.match(/lucide-chevron-left/g)?.length).toBe(4);
    expect(html).toContain("text-section");
  });

  it("«خروج» is the last row, apart, in danger red with the LogOut mark", async () => {
    const html = await page();
    const logout = html.indexOf('<nav aria-label="خروج">');
    expect(logout).toBeGreaterThan(html.indexOf('href="/roadmap"'));
    const tail = html.slice(logout);
    expect(tail).toContain("text-danger");
    expect(tail).toContain("lucide-log-out");
    expect(tail).toContain(">خروج</span>");
  });
});
