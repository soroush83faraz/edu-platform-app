// canViewWorkItem — personal todos (QA round 1, m5): a `todo` whose only assignee is its creator is visible to that
// person alone; the broad `workspace.work_item.read` of managers does not reach it (NOT_FOUND, never FORBIDDEN), so
// nobody else can open or reopen it. A `todo` a manager gives to ONE other person is not personal and stays visible
// to broad readers. Every business write happens inside a tenant transaction that ends with Rollback; the global
// fixtures provide the system `todo` type + its `open` status, and the one notification type the fan-out needs is
// written as app_owner in beforeAll and removed again in afterAll (the same pattern as workspace-service.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import { AppError } from "@/lib/errors";
import type { Assignment } from "@/modules/iam/can";
import { canViewWorkItem, changeStatus, createWorkItem, getWorkItemDetail, type WorkspaceCtx } from "@/modules/workspace/service";
import * as f from "./fixtures";
import { Rollback, asAppOwner } from "./helpers";

const NT_ASSIGNED = "work_item.assigned";

const WORK_PERMS = ["workspace.work_item.read", "workspace.work_item.create", "workspace.work_item.update", "workspace.work_item.comment", "workspace.work_item.assign_class"];
const STUDENT_PERMS = ["workspace.work_item.read", "workspace.work_item.update", "workspace.work_item.comment"];

const orgAdminOf = (roleId: string): Assignment => ({ roleCode: "org_admin", roleId, scopeType: "organization", scopeId: f.ORG_A, permissions: WORK_PERMS });
const principalOf = (schoolId: string): Assignment => ({ roleCode: "school_principal", roleId: "r-principal", scopeType: "school", scopeId: schoolId, permissions: WORK_PERMS });
const studentRole: Assignment = { roleCode: "student", roleId: "r-student", scopeType: "student", scopeId: f.STUDENT_A1, permissions: STUDENT_PERMS };

const ctxOf = (personId: string, assignments: Assignment[]): WorkspaceCtx => ({ orgId: f.ORG_A, personId, userId: null, requestId: "int-test", assignments });
/** PERSON_A2 (staff) wears the manager hat that creates the items; PERSON_A1 is the student. */
const manager = ctxOf(f.PERSON_A2, [orgAdminOf("r-admin-1")]);
const student = ctxOf(f.PERSON_A1, [studentRole]);

/** Neither creator nor assignee of anything here; a manager's hat is all that matters for the read (no row is written for them). */
const BYSTANDER_PERSON = "0199a000-0006-7000-8000-0000000000a9";

const isCode = (code: string) => (err: unknown) => AppError.is(err) && err.code === code;

beforeAll(async () => {
  await asAppOwner((c) => c.query(`insert into notif.notification_type (code, module, name) values ($1, 'workspace', $1) on conflict (code) do nothing`, [NT_ASSIGNED]));
});

afterAll(async () => {
  await asAppOwner((c) => c.query(`delete from notif.notification_type where code = $1`, [NT_ASSIGNED]));
});

async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withTenant({ orgId: f.ORG_A, personId: f.PERSON_A2 }, async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (err instanceof Rollback) return;
    throw err;
  }
  throw new Error("expected the transaction to roll back");
}

describe("canViewWorkItem — personal todos", () => {
  it("a self todo is visible to its owner only: organization- and school-scoped readers get NOT_FOUND on open, detail and status change", async () => {
    await rolledBack(async (tx) => {
      const own = await createWorkItem(tx, student, { typeCode: "todo", title: "کار شخصی من", priority: "normal", recipients: { kind: "self" } });
      expect(own.assigneeCount).toBe(1);
      await expect(canViewWorkItem(tx, student, own.id)).resolves.toMatchObject({ id: own.id, typeCode: "todo" });

      const orgAdmin = ctxOf(f.PERSON_A2, [orgAdminOf("r-admin-2")]);
      const principal = ctxOf(f.PERSON_A2, [principalOf(f.SCHOOL_A)]);
      for (const reader of [orgAdmin, principal]) {
        await expect(canViewWorkItem(tx, reader, own.id)).rejects.toSatisfy(isCode("NOT_FOUND"));
        await expect(getWorkItemDetail(tx, reader, own.id)).rejects.toSatisfy(isCode("NOT_FOUND"));
        await expect(changeStatus(tx, reader, { workItemId: own.id, toStatusCode: "open" })).rejects.toSatisfy(isCode("NOT_FOUND"));
      }
      // The same shape as an unknown id — the item's existence is not leaked.
      await expect(canViewWorkItem(tx, orgAdmin, "0199a000-00f3-7000-8000-000000000999")).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
  });

  it("a manager's own self todo stays visible to the manager (creator), not to another manager", async () => {
    await rolledBack(async (tx) => {
      const own = await createWorkItem(tx, manager, { typeCode: "todo", title: "یادداشت مدیر", priority: "low", recipients: { kind: "self" } });
      await expect(canViewWorkItem(tx, manager, own.id)).resolves.toMatchObject({ id: own.id });
      const otherManager = ctxOf(f.PERSON_A1, [orgAdminOf("r-admin-3")]);
      await expect(canViewWorkItem(tx, otherManager, own.id)).rejects.toSatisfy(isCode("NOT_FOUND"));
    });
  });

  it("a todo given by a manager to one other person is NOT personal: creator, assignee and broad readers all see it", async () => {
    await rolledBack(async (tx) => {
      const given = await createWorkItem(tx, manager, { typeCode: "todo", title: "برای دانش‌آموز", priority: "normal", recipients: { kind: "persons", ids: [f.PERSON_A1] } });
      expect(given.assigneeCount).toBe(1);
      await expect(canViewWorkItem(tx, manager, given.id)).resolves.toMatchObject({ id: given.id });
      await expect(canViewWorkItem(tx, student, given.id)).resolves.toMatchObject({ id: given.id });
      const otherReader = ctxOf(BYSTANDER_PERSON, [orgAdminOf("r-admin-4")]); // a broad reader who is neither creator nor assignee
      await expect(canViewWorkItem(tx, otherReader, given.id)).resolves.toMatchObject({ id: given.id });
    });
  });
});
