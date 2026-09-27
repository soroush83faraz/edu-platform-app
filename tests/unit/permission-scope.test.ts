// `getPermissionScope` (src/modules/iam/service.ts, verifier 2026-09-27): where the caller holds a permission through a
// BROAD assignment — organization → the whole organization, else the schools of the school/branch assignments that
// carry THAT permission; teacher/student assignments never widen it; none → FORBIDDEN. It is the reach of the
// work-item «اشخاص» picker (`workspace.work_item.create`) and, for `iam.admin.access`, exactly `getAdminScope` — which
// now delegates to it, so the equality is pinned here too. The only query is the branch → school lookup; the fake
// transaction answers it (every branch here is BRANCH_OF_B) and counts the calls.
import { beforeEach, describe, expect, it } from "vitest";
import type { Tx } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import type { Assignment } from "@/modules/iam/can";
import { getAdminScope, getPermissionScope } from "@/modules/iam/service";

const ORG = "org-1";
const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const BRANCH_OF_B = "branch-of-b";

/** `select school_id from tenancy.branch where id = …` → SCHOOL_B (the only branch these hats name). */
let branchLookups = 0;
const tx = {
  execute: async () => {
    branchLookups++;
    return { rows: [{ school_id: SCHOOL_B }] };
  },
} as unknown as Tx;
beforeEach(() => {
  branchLookups = 0;
});

const ALL = ["iam.admin.access", "workspace.work_item.create", "workspace.work_item.read"];
const hat = (roleCode: string, scopeType: Assignment["scopeType"], scopeId: string, permissions: string[] = ALL): Assignment => ({ roleCode, roleId: `r-${roleCode}`, scopeType, scopeId, permissions });

const orgAdmin = hat("org_admin", "organization", ORG);
const principalA = hat("school_principal", "school", SCHOOL_A);
const viceAtBranchOfB = hat("vice_principal", "branch", BRANCH_OF_B);
const teacherAtB = hat("teacher", "class_offering", "offering-of-b", ["workspace.work_item.create", "workspace.work_item.read"]);
const student = hat("student", "student", "profile-1", ["workspace.work_item.create", "workspace.work_item.read"]);
/** An organization-wide hat WITHOUT the permission asked about: it must not make the answer organization-wide. */
const orgReader = hat("auditor", "organization", ORG, ["workspace.work_item.read"]);

const scopeOf = (permission: "workspace.work_item.create" | "iam.admin.access", ...assignments: Assignment[]) => getPermissionScope(tx, { orgId: ORG, assignments }, permission);
const isForbidden = (e: unknown) => AppError.is(e) && e.code === "FORBIDDEN";

describe("getPermissionScope", () => {
  it("an organization-scoped holder of the permission → the whole organization (no query)", async () => {
    expect(await scopeOf("workspace.work_item.create", orgAdmin)).toEqual({ kind: "organization" });
    expect(await scopeOf("workspace.work_item.create", principalA, viceAtBranchOfB, orgAdmin)).toEqual({ kind: "organization" });
    expect(branchLookups).toBe(0);
  });

  it("school managers → their schools (a branch counts as its school); teacher and student hats never widen it", async () => {
    expect(await scopeOf("workspace.work_item.create", principalA)).toEqual({ kind: "school", schoolIds: [SCHOOL_A] });
    expect(await scopeOf("workspace.work_item.create", principalA, teacherAtB, student)).toEqual({ kind: "school", schoolIds: [SCHOOL_A] });
    expect(branchLookups).toBe(0);
    const both = await scopeOf("workspace.work_item.create", principalA, viceAtBranchOfB);
    expect(both.kind === "school" && [...both.schoolIds].sort()).toEqual([SCHOOL_A, SCHOOL_B]);
    expect(branchLookups).toBe(1);
  });

  it("only assignments carrying THAT permission count: an organization-wide read-only hat does not make «اشخاص» organization-wide", async () => {
    expect(await scopeOf("workspace.work_item.create", orgReader, principalA)).toEqual({ kind: "school", schoolIds: [SCHOOL_A] });
  });

  it("no broad holder → FORBIDDEN (a teacher, a student, nobody)", async () => {
    for (const hats of [[teacherAtB], [student], [orgReader], []]) {
      await expect(scopeOf("workspace.work_item.create", ...hats)).rejects.toSatisfy(isForbidden);
    }
  });

  it("getAdminScope is getPermissionScope for `iam.admin.access`", async () => {
    for (const hats of [[orgAdmin], [principalA], [principalA, viceAtBranchOfB], [principalA, teacherAtB]]) {
      expect(await getAdminScope(tx, { orgId: ORG, assignments: hats })).toEqual(await scopeOf("iam.admin.access", ...hats));
    }
    await expect(getAdminScope(tx, { orgId: ORG, assignments: [teacherAtB] })).rejects.toSatisfy(isForbidden);
  });
});
