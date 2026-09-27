// Owner, 2026-09-27: «کد مدرسه» is shown to the organization admin ONLY. A school-scoped manager (principal, vice
// principal) is never sent it — the hub's school projection drops it, the schools list drops its column, the student
// form gets no code (its username hint stays generic). Rendered statically and inspected as strings; the DB side
// (the list query, the update that ignores a crafted `code`) is tests/int/school-code.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AnyResourceDef } from "@/lib/admin/defineResource";
import type { AdminScope } from "@/modules/iam/service";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, back: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
// The server actions pull in the whole server stack (db, session); nothing here is submitted.
vi.mock("@/lib/admin/actions", () => ({ adminResourceMutate: async () => ({ ok: false, code: "INTERNAL", message: "" }) }));
vi.mock("@/lib/admin/people-actions", () => {
  const never = async () => ({ ok: false, code: "INTERNAL", message: "" });
  return { createStudentAction: never, updateStudentAction: never };
});

const { seesSchoolCode, withSchoolCodeFor } = await import("@/lib/admin/school-code");
const { resourceViewFor } = await import("@/lib/admin/defineResource");
const { SchoolHubFacts } = await import("@/components/admin/SchoolHubFacts");
const { ResourceTable } = await import("@/components/admin/ResourceTable");
const { StudentForm } = await import("@/components/admin/StudentForm");

const SCHOOL = "0199a000-0001-7000-8000-00000000000a";
const ORG: AdminScope = { kind: "organization" };
const PRINCIPAL: AdminScope = { kind: "school", schoolIds: [SCHOOL] };
const row = { id: SCHOOL, name: "دبیرستان البرز", code: "ALK", genderPolicy: "girls", isDefault: true };

/** The school list's shape (`schoolResource` pulls the DB client; its real columns are rendered in the int test). */
const schoolsDef = {
  key: "schools",
  labelFa: "مدرسه",
  labelFaPlural: "مدرسه‌ها",
  descriptionFa: "روی هر مدرسه بزنید.",
  orgDescriptionFa: "کد مدرسه پیشوند نام‌کاربری است. روی هر مدرسه بزنید.",
  permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" },
  columns: [
    { key: "name", labelFa: "نام" },
    { key: "code", labelFa: "کد", render: (r: { code?: string }) => createElement("bdi", { dir: "ltr" }, r.code), mobileMeta: 1, orgOnly: true },
  ],
  formFields: [
    { name: "name", labelFa: "نام مدرسه", type: "text", required: true },
    { name: "code", labelFa: "کد (انگلیسی)", type: "text", required: true, createOnly: true, ltr: true },
  ],
  rowHref: (r: { id: string }) => `/admin/schools/${r.id}`,
} as unknown as AnyResourceDef;

describe("school code: organization admin only", () => {
  it("seesSchoolCode / withSchoolCodeFor: kept for the organization scope, dropped (not blanked) for a school scope", () => {
    expect(seesSchoolCode(ORG)).toBe(true);
    expect(seesSchoolCode(PRINCIPAL)).toBe(false);
    expect(withSchoolCodeFor(ORG, row)).toEqual(row);
    const forPrincipal = withSchoolCodeFor(PRINCIPAL, row);
    expect("code" in forPrincipal).toBe(false);
    expect(JSON.stringify(forPrincipal)).not.toContain("ALK");
  });

  it("school hub header: the organization admin reads the code, a principal does not", () => {
    const facts = (scope: AdminScope) => renderToStaticMarkup(createElement(SchoolHubFacts, { code: withSchoolCodeFor(scope, row).code, genderLabel: "دخترانه", yearName: "۱۴۰۵-۱۴۰۶" }));
    const org = facts(ORG);
    expect(org).toContain("ALK");
    expect(org).toContain("دخترانه");
    const principal = facts(PRINCIPAL);
    expect(principal).not.toContain("ALK");
    expect(principal).not.toContain('dir="ltr"');
    expect(principal).toContain("دخترانه");
    expect(principal).toContain("۱۴۰۵-۱۴۰۶");
  });

  it("schools list: the «کد» column and the code-naming description exist for the organization admin only; the edit menu never carries the code", () => {
    const orgView = resourceViewFor(schoolsDef, ORG);
    expect(orgView.descriptionFa).toContain("کد مدرسه");
    const orgHtml = renderToStaticMarkup(createElement(ResourceTable, { def: orgView, rows: [row], options: {}, canWrite: true }));
    expect(orgHtml).toContain("ALK");
    expect(orgHtml).toContain(">کد<");

    const principalView = resourceViewFor(schoolsDef, PRINCIPAL);
    expect(principalView.columns.map((c) => c.key)).toEqual(["name"]);
    expect(principalView.descriptionFa).not.toContain("کد");
    // The principal's rows come without the code (int test); even a stray one is not rendered by their view.
    const principalHtml = renderToStaticMarkup(createElement(ResourceTable, { def: principalView, rows: [withSchoolCodeFor(PRINCIPAL, row)], options: {}, canWrite: true }));
    expect(principalHtml).toContain("دبیرستان البرز");
    expect(principalHtml).not.toContain("ALK");
    expect(principalHtml).not.toContain(">کد<");
  });

  it("student form: the username preview names the code for the organization admin; a principal's form gets no code and a generic hint", () => {
    const form = (schools: Array<{ value: string; label: string; code?: string }>) => renderToStaticMarkup(createElement(StudentForm, { classes: [], schools }));
    const org = form([{ value: SCHOOL, label: row.name, code: "ALK" }]);
    expect(org).toContain("alk-");
    const principal = form([{ value: SCHOOL, label: row.name }]);
    expect(principal).not.toContain("alk-");
    expect(principal).not.toContain("کد مدرسه");
    expect(principal).toContain("نام‌کاربری خودکار ساخته می‌شود");
  });
});
