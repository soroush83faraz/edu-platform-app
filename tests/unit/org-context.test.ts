// Owner (organisation admin, 2026-09-27): «چرا بالا نوشته علامه طباطبایی؟ مدیر سازمان بالاتر از مدرسه است». The
// organization admin's context is the ORGANIZATION everywhere a context is named — the PageHeader's desktop context
// bar, the shell's title, the greeting and the profile card (the latter two: hub-home.test.ts, profile-page.test.ts)
// — never a school or a branch, even when the organization has one school and even when they also teach. School-
// scoped managers, teachers and students keep their school. `contextPlaceFa` is the one rule.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contextLineFa, contextPlaceFa } from "@/lib/context-place";
import type { Assignment } from "@/modules/iam/can";

type Shell = { orgScoped?: boolean; orgName?: string | null; schoolName: string | null; yearName: string | null; termName: string | null; schools: { id: string; name: string }[] };
const shell = vi.hoisted(() => ({ value: null as unknown as Shell }));
vi.mock("@/lib/ui-variant", () => ({ getUiVariant: async () => "hub" }));
vi.mock("@/lib/shell-context", () => ({ getShellContext: async () => shell.value }));

const { PageHeader } = await import("@/components/layout/PageHeader");

const ORG = "مجتمع آموزشی نمونه";
const BRANCH = "نمونه — شعبهٴ یک";
const orgAdmin: Assignment = { roleCode: "org_admin", roleId: "r", scopeType: "organization", scopeId: "o", permissions: ["iam.admin.access"] };
const principal: Assignment = { roleCode: "school_principal", roleId: "r", scopeType: "school", scopeId: "s", permissions: ["iam.admin.access"] };
const teacher: Assignment = { roleCode: "teacher", roleId: "r", scopeType: "class_offering", scopeId: "c", permissions: ["workspace.work_item.read"] };
const student: Assignment = { roleCode: "student", roleId: "r", scopeType: "student", scopeId: "p", permissions: ["workspace.work_item.read"] };

const ORG_SHELL: Shell = { orgScoped: true, orgName: ORG, schoolName: null, yearName: "۱۴۰۵-۱۴۰۶", termName: null, schools: [] };
const SCHOOL_SHELL: Shell = { orgScoped: false, orgName: ORG, schoolName: BRANCH, yearName: "۱۴۰۵-۱۴۰۶", termName: "نوبت اول", schools: [] };

/** The desktop context bar's text: the first <p> of the header, tags stripped. */
async function contextBar(): Promise<string> {
  const html = renderToStaticMarkup(await PageHeader({ title: "عنوان" }));
  return (html.match(/<p class="hidden[^"]*\[grid-area:context\][^"]*">([\s\S]*?)<\/p>/)?.[1] ?? "").replace(/<[^>]+>/g, "");
}

beforeEach(() => {
  shell.value = SCHOOL_SHELL;
});

describe("contextPlaceFa / contextLineFa", () => {
  it("the organization admin: the organization, «مدیر سازمان · …» — even with one school, even when they teach", () => {
    for (const assignments of [[orgAdmin], [orgAdmin, teacher]]) {
      expect(contextPlaceFa(ORG_SHELL, { orgName: ORG, schoolName: BRANCH, assignments })).toBe(ORG);
      expect(contextLineFa(ORG_SHELL, { orgName: ORG, schoolName: BRANCH, assignments })).toEqual({ role: "مدیر سازمان", place: ORG });
      // A failed shell read (empty context) still never falls back to the primary school: the session says org.
      expect(contextPlaceFa({ schoolName: null, schools: [] }, { orgName: ORG, schoolName: BRANCH, assignments })).toBe(ORG);
    }
  });

  it("a principal, a teacher and a student keep their school, with no role prefix", () => {
    for (const assignments of [[principal], [teacher], [student], [principal, teacher]]) {
      expect(contextLineFa(SCHOOL_SHELL, { orgName: ORG, schoolName: "مدرسهٴ اصلی", assignments })).toEqual({ role: null, place: BRANCH });
    }
    // No school in the shell: the session's primary school, then the organization.
    expect(contextPlaceFa({ schoolName: null, schools: [] }, { orgName: ORG, schoolName: "مدرسهٴ اصلی", assignments: [teacher] })).toBe("مدرسهٴ اصلی");
    expect(contextPlaceFa({ schoolName: null, schools: [] }, { orgName: ORG, schoolName: null, assignments: [teacher] })).toBe(ORG);
  });

  it("a school-scoped admin over several schools is introduced by the organization (QA round 3), without the org-admin hat", () => {
    const two = { schoolName: null, schools: [{ id: "a" }, { id: "b" }] };
    expect(contextLineFa(two, { orgName: ORG, schoolName: BRANCH, assignments: [principal] })).toEqual({ role: null, place: ORG });
  });
});

describe("PageHeader's desktop context bar", () => {
  it("the organization admin: «<organization> · <year>» — no school, no branch, no نوبت", async () => {
    shell.value = ORG_SHELL;
    const bar = await contextBar();
    expect(bar).toContain(ORG);
    expect(bar).toContain("۱۴۰۵-۱۴۰۶");
    expect(bar).not.toContain(BRANCH);
    expect(bar).not.toContain("نوبت");
  });

  it("the organization admin of several schools: the organization, then the «۲ مدرسه» chip", async () => {
    shell.value = { ...ORG_SHELL, schools: [{ id: "a", name: "الف" }, { id: "b", name: "ب" }] };
    const bar = await contextBar();
    expect(bar.indexOf(ORG)).toBeGreaterThan(-1);
    expect(bar.indexOf("مدرسه")).toBeGreaterThan(bar.indexOf(ORG));
  });

  it("a principal (school scope): «<school> · <year> · <نوبت>», no organization", async () => {
    const bar = await contextBar();
    expect(bar).toContain(BRANCH);
    expect(bar).toContain("نوبت اول");
    expect(bar).not.toContain(ORG);
  });
});
