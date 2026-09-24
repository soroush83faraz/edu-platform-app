// QA round 1 blocker (B1): editing an existing «ارائهٴ درس» did nothing for every role — the edit form omits the
// `createOnly` fields (`subjectId`, `termId`), the strict schema required them, and the errors landed on fields
// nobody could see. These tests drive `mutateResource` (the body of `adminResourceMutate`, minus the session gate)
// with the EXACT payload the edit form sends, for a vice principal and a principal of the fixture school, and assert
// the main-teacher assignment changes. A structural guard checks every resource's schema against its edit form.
// Everything runs in withTenant transactions that end with Rollback; nothing is committed.
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { staffProfile, teacherAssignment } from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { ResourceCtx } from "@/lib/admin/defineResource";
import { mutateResource } from "@/lib/admin/mutate";
import { ADMIN_NAV, RESOURCES, adminNavFor } from "@/lib/admin/resources";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import * as f from "./fixtures";
import { Rollback } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
const VICE_PERMS = ["iam.admin.access", "tenancy.structure.read", "iam.person.read", "iam.person.write", "academic.enrollment.write", "academic.teacher_assignment.write", "iam.account.reset_password", "iam.account.unlock", "notif.notification.read"];
const principalOf = (schoolId: string): Assignment => ({ roleCode: "school_principal", roleId: "r-principal", scopeType: "school", scopeId: schoolId, permissions: ALL });
const viceOf = (schoolId: string): Assignment => ({ roleCode: "vice_principal", roleId: "r-vice", scopeType: "school", scopeId: schoolId, permissions: VICE_PERMS });
const ctxOf = (...assignments: Assignment[]): ResourceCtx => ({ orgId: f.ORG_A, personId: f.PERSON_A2, userId: "00000000-0000-7000-8000-000000000000", requestId: "int-form", ip: "127.0.0.1", userAgent: null, assignments });

const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const rolledBack = (fn: (tx: Tx) => Promise<void>) => expect(withTenant(tenant, fn)).rejects.toBeInstanceOf(Rollback);
const isError = (code: string) => (e: unknown) => AppError.is(e) && e.code === code;

/** What `ResourceForm` sends on «ذخیره» for an offering: fixed parent id + the non-createOnly fields, nothing else. */
const editPayload = (mainTeacherStaffProfileId: string | null) => ({ classGroupId: f.CLASS_GROUP_A1, mainTeacherStaffProfileId, weeklyHours: null, status: "active" });

const mainTeacher = (tx: Tx) =>
  tx
    .select({ staffProfileId: teacherAssignment.staffProfileId })
    .from(teacherAssignment)
    .where(and(eq(teacherAssignment.classOfferingId, f.OFFERING_A1), eq(teacherAssignment.role, "main"), isNull(teacherAssignment.validTo)));

describe("B1 — offering edit through the mutation path", () => {
  it("vice principal: the edit form's payload sets, then clears, the main teacher; the derived assignment follows", async () => {
    await rolledBack(async (tx) => {
      // Anchor the fixture staff member in school A so the school-scoped vice may pick them (staffAssignableSql).
      await tx.update(staffProfile).set({ schoolId: f.SCHOOL_A }).where(eq(staffProfile.id, f.STAFF_A2));
      const vice = ctxOf(viceOf(f.SCHOOL_A));
      expect(await mainTeacher(tx)).toEqual([]);
      await mutateResource(tx, vice, { resource: "offerings", op: "update", id: f.OFFERING_A1, data: editPayload(f.STAFF_A2) });
      expect(await mainTeacher(tx)).toEqual([{ staffProfileId: f.STAFF_A2 }]);
      // Unchanged resubmit is a no-op; clearing ends the assignment.
      await mutateResource(tx, vice, { resource: "offerings", op: "update", id: f.OFFERING_A1, data: editPayload(f.STAFF_A2) });
      expect(await mainTeacher(tx)).toHaveLength(1);
      await mutateResource(tx, vice, { resource: "offerings", op: "update", id: f.OFFERING_A1, data: editPayload(null) });
      expect(await mainTeacher(tx)).toEqual([]);
      // Structure stays with the principal: hours change → FORBIDDEN for the vice, fine for the principal.
      await expect(mutateResource(tx, vice, { resource: "offerings", op: "update", id: f.OFFERING_A1, data: { ...editPayload(null), weeklyHours: 3 } })).rejects.toSatisfy(isError("FORBIDDEN"));
      throw new Rollback();
    });
  });

  it("principal: the same payload assigns the teacher and changes hours; an empty create names the missing selects", async () => {
    await rolledBack(async (tx) => {
      await tx.update(staffProfile).set({ schoolId: f.SCHOOL_A }).where(eq(staffProfile.id, f.STAFF_A2));
      const principal = ctxOf(principalOf(f.SCHOOL_A));
      await mutateResource(tx, principal, { resource: "offerings", op: "update", id: f.OFFERING_A1, data: { ...editPayload(f.STAFF_A2), weeklyHours: 3 } });
      expect(await mainTeacher(tx)).toEqual([{ staffProfileId: f.STAFF_A2 }]);
      // m10: the empty create form («انتخاب کنید…» sends "") gets the Persian field messages, not a hidden uuid error.
      await expect(mutateResource(tx, principal, { resource: "offerings", op: "create", data: { classGroupId: f.CLASS_GROUP_A1, subjectId: "", termId: "", mainTeacherStaffProfileId: null, weeklyHours: null, status: "active" } })).rejects.toSatisfy(
        (e: unknown) => AppError.is(e) && e.code === "VALIDATION" && JSON.stringify(e.details) === JSON.stringify({ fieldErrors: { subjectId: ["درس را انتخاب کنید."], termId: ["نوبت را انتخاب کنید."] } }),
      );
      throw new Rollback();
    });
  });
});

describe("admin sub-navigation (owner's rule, QA round 2): «مدرسه‌ها» and «راه‌اندازی» are for the organization admin only", () => {
  const orgAdmin: Assignment = { roleCode: "org_admin", roleId: "r-org", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL };
  it("school-scoped admins lose the organization-only entries; the organization admin keeps the whole list", () => {
    expect(adminNavFor([orgAdmin]).map((i) => i.href)).toEqual(ADMIN_NAV.map((i) => i.href));
    for (const assignments of [[principalOf(f.SCHOOL_A)], [viceOf(f.SCHOOL_A)]]) {
      const hrefs = adminNavFor(assignments).map((i) => i.href);
      expect(hrefs).not.toContain("/admin/infrastructure");
      // Round 7: the organization's schools LIST is organization-only too — a principal's door to their own
      // school is the Home tile that opens that school's hub, never this list.
      expect(hrefs).not.toContain("/admin/schools");
      expect(hrefs).toEqual(ADMIN_NAV.filter((i) => !i.orgOnly).map((i) => i.href));
    }
    expect(ADMIN_NAV.filter((i) => i.orgOnly).map((i) => i.href)).toEqual(["/admin/schools", "/admin/infrastructure"]);
  });
});

/** Required top-level keys of a strict object schema (a key is optional when `undefined` parses). */
function requiredKeys(schema: z.ZodType): string[] {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape;
  if (!shape) throw new Error("resource schema is not a ZodObject");
  return Object.entries(shape)
    .filter(([, v]) => !v.safeParse(undefined).success)
    .map(([k]) => k);
}

describe("every admin resource: edit payload ⊆ schema (no required key the edit form cannot send)", () => {
  for (const def of Object.values(RESOURCES)) {
    it(def.key, () => {
      const editable = new Set([...def.formFields.filter((x) => !x.createOnly).map((x) => x.name), ...(def.parentParam ? [def.parentParam.field] : [])]);
      expect(requiredKeys(def.schema).filter((k) => !editable.has(k))).toEqual([]);
    });
  }

  it("classes: capacity messages are Persian (optionalInt); offerings: hours message is Persian", () => {
    const cls = RESOURCES.classes!;
    const messages = (capacity: unknown) => {
      const r = cls.schema.safeParse({ gradeLevelId: f.GRADE_A, name: "۱۰/۳", capacity });
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(messages("x")).toEqual(["ظرفیت باید عدد باشد."]);
    expect(messages(0)).toEqual(["ظرفیت دست‌کم ۱ است."]);
    expect(messages(201)).toEqual(["ظرفیت حداکثر ۲۰۰ است."]);
    expect(messages(1.5)).toEqual(["ظرفیت باید عدد صحیح باشد."]);
    expect(messages(null)).toEqual([]);
    const r = RESOURCES.offerings!.schema.safeParse({ ...editPayload(null), weeklyHours: "abc" });
    expect(r.success ? [] : r.error.issues.map((i) => i.message)).toEqual(["ساعت در هفته باید عدد باشد."]);
  });

  /** What a required `<select>` left on «انتخاب کنید…» sends (`serialize`: `""` for a required select). */
  const issuesFor = (resource: string, data: Record<string, unknown>) => {
    const r = RESOURCES[resource]!.schema.safeParse(data);
    return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
  };

  it("QA round 2: every required select on an edit form names itself when left empty — «پایه را انتخاب کنید.», «مقطع را انتخاب کنید.»", () => {
    expect(issuesFor("classes", { gradeLevelId: "", name: "۱۰/۳", capacity: null })).toEqual({ gradeLevelId: "پایه را انتخاب کنید." });
    expect(issuesFor("classes", { gradeLevelId: null, name: "۱۰/۳", capacity: null })).toEqual({ gradeLevelId: "پایه را انتخاب کنید." });
    expect(issuesFor("classes", { gradeLevelId: "not-a-uuid", name: "۱۰/۳", capacity: null })).toEqual({ gradeLevelId: "شناسه نامعتبر است." });
    expect(issuesFor("grades", { educationLevelId: "", name: "دهم", code: "G10", sequence: 1 })).toEqual({ educationLevelId: "مقطع را انتخاب کنید." });
    // Every required select that the schema itself validates (not create-only) refuses "" with a «… را انتخاب کنید.» message.
    for (const def of Object.values(RESOURCES)) {
      for (const field of def.formFields.filter((x) => x.type === "select" && x.required && !x.createOnly && !x.options)) {
        const r = def.schema.safeParse({ [field.name]: "" });
        const issue = r.success ? undefined : r.error.issues.find((i) => i.path[0] === field.name);
        expect(issue?.message, `${def.key}.${field.name}`).toBe(`${field.labelFa} را انتخاب کنید.`);
      }
    }
  });

  it("QA round 2: the empty class create names the create-only selects too («مدرسه / شعبه», «سال تحصیلی»)", async () => {
    await rolledBack(async (tx) => {
      const principal = ctxOf(principalOf(f.SCHOOL_A));
      const base = { gradeLevelId: f.GRADE_A, name: "۱۰/۹", capacity: null };
      await expect(mutateResource(tx, principal, { resource: "classes", op: "create", data: { ...base, branchId: "", academicYearId: "" } })).rejects.toSatisfy(
        (e: unknown) => AppError.is(e) && e.code === "VALIDATION" && JSON.stringify(e.details) === JSON.stringify({ fieldErrors: { branchId: ["مدرسه / شعبه را انتخاب کنید."], academicYearId: ["سال تحصیلی را انتخاب کنید."] } }),
      );
      await expect(mutateResource(tx, principal, { resource: "classes", op: "create", data: { ...base, branchId: f.BRANCH_A, academicYearId: "" } })).rejects.toSatisfy(
        (e: unknown) => AppError.is(e) && e.code === "VALIDATION" && e.message === "سال تحصیلی را انتخاب کنید.",
      );
      throw new Rollback();
    });
  });
});
