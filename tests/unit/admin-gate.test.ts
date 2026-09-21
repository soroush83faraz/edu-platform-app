// `resourceOpGate` — the one decision behind `adminResourceMutate` (throws) and `adminResourceList` (hides buttons):
// the op's permission at any scope (`permission.create` for new rows when set, else `write`), then the
// organization-scope rules (`orgOnly`, `createNeedsOrgScope`). Pure: a fake definition, no database.
import { describe, expect, it } from "vitest";
import { GATE_MESSAGES, resourceOpGate, type AnyResourceDef } from "@/lib/admin/defineResource";
import type { Assignment } from "@/modules/iam/can";
import type { AdminScope } from "@/modules/iam/service";

const SCHOOL = "0199a000-0001-7000-8000-0000000000aa";
const orgScope: AdminScope = { kind: "organization" };
const schoolScope: AdminScope = { kind: "school", schoolIds: [SCHOOL] };

const assignment = (scopeType: Assignment["scopeType"], permissions: string[]): Assignment => ({ roleCode: "x", roleId: "r", scopeType, scopeId: scopeType === "organization" ? "org" : SCHOOL, permissions });
const orgAdmin = [assignment("organization", ["iam.admin.access", "tenancy.structure.write", "academic.teacher_assignment.write"])];
const principal = [assignment("school", ["iam.admin.access", "tenancy.structure.write", "academic.teacher_assignment.write"])];
const vice = [assignment("school", ["iam.admin.access", "academic.teacher_assignment.write"])];

/** Only the fields the gate reads. */
const def = (over: Partial<AnyResourceDef>): AnyResourceDef => ({ key: "x", labelFa: "مدرسه", labelFaPlural: "x", permission: { read: "tenancy.structure.read", write: "tenancy.structure.write" }, columns: [], schema: undefined as never, formFields: [], list: undefined as never, create: undefined as never, update: undefined as never, ...over });

describe("resourceOpGate", () => {
  it("plain school-owned resource: the write permission at any scope decides every op", () => {
    const classes = def({});
    for (const op of ["create", "update", "archive"] as const) {
      expect(resourceOpGate(classes, op, orgAdmin, orgScope)).toEqual({ ok: true });
      expect(resourceOpGate(classes, op, principal, schoolScope)).toEqual({ ok: true });
      expect(resourceOpGate(classes, op, vice, schoolScope)).toEqual({ ok: false });
    }
  });

  it("orgOnly catalogs: school-scoped admins are refused with the catalog message even when they hold the permission", () => {
    const levels = def({ orgOnly: true });
    expect(resourceOpGate(levels, "update", orgAdmin, orgScope)).toEqual({ ok: true });
    expect(resourceOpGate(levels, "update", principal, schoolScope)).toEqual({ ok: false, message: GATE_MESSAGES.orgOnly });
    expect(resourceOpGate(levels, "create", principal, schoolScope)).toEqual({ ok: false, message: GATE_MESSAGES.orgOnly });
  });

  it("createNeedsOrgScope (schools): a principal edits but does not create; the message names the resource with the written ezafe", () => {
    const schools = def({ createNeedsOrgScope: true });
    expect(resourceOpGate(schools, "update", principal, schoolScope)).toEqual({ ok: true });
    expect(resourceOpGate(schools, "create", principal, schoolScope)).toEqual({ ok: false, message: "ساختن مدرسهٴ جدید فقط با مدیر سازمان است." });
    expect(resourceOpGate(schools, "create", orgAdmin, orgScope)).toEqual({ ok: true });
    // No permission at all wins over the scope message (nothing to explain to someone who cannot write).
    expect(resourceOpGate(schools, "create", vice, schoolScope)).toEqual({ ok: false });
    expect(GATE_MESSAGES.createNeedsOrgScope("کلاس")).toBe("ساختن کلاس جدید فقط با مدیر سازمان است.");
  });

  it("permission.create (offerings): the vice principal edits existing rows, only structure.write holders create", () => {
    const offerings = def({ permission: { read: "tenancy.structure.read", write: "academic.teacher_assignment.write", create: "tenancy.structure.write" } });
    expect(resourceOpGate(offerings, "update", vice, schoolScope)).toEqual({ ok: true });
    expect(resourceOpGate(offerings, "archive", vice, schoolScope)).toEqual({ ok: true });
    expect(resourceOpGate(offerings, "create", vice, schoolScope)).toEqual({ ok: false });
    expect(resourceOpGate(offerings, "create", principal, schoolScope)).toEqual({ ok: true });
    expect(resourceOpGate(offerings, "create", orgAdmin, orgScope)).toEqual({ ok: true });
  });
});
