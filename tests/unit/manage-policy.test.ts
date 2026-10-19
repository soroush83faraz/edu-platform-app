// Who manages a کار (verifier, 2026-09-27 — src/modules/workspace/manage-policy.ts): the creator always; an ASSIGNEE
// who did not create it never, whatever their hats (a principal given a «تسک» by the organization admin only marks
// their own row); everyone else only through a BROAD `workspace.work_item.update` (the admin override — e.g. removing
// spam). Pure — the service paths are covered end to end in tests/int/workspace-service.test.ts.
import { describe, expect, it } from "vitest";
import type { Assignment } from "@/modules/iam/can";
import { answerNeedsText, closesOnFirstAnswer, creatorParticipates, managesItem } from "@/modules/workspace/manage-policy";

const WORK = ["workspace.work_item.read", "workspace.work_item.create", "workspace.work_item.update", "workspace.work_item.comment"];
const hat = (roleCode: string, scopeType: Assignment["scopeType"], permissions: string[] = WORK): Assignment => ({ roleCode, roleId: `r-${roleCode}`, scopeType, scopeId: `s-${scopeType}`, permissions });

const orgAdmin = hat("org_admin", "organization");
const principal = hat("school_principal", "school");
const branchVice = hat("vice_principal", "branch");
const teacher = hat("teacher", "class_offering", [...WORK, "workspace.work_item.assign_class"]);
const student = hat("student", "student");
/** A broad hat WITHOUT `update` (read-only): never an override. */
const broadReader = hat("auditor", "organization", ["workspace.work_item.read"]);

const ME = "p-me";
const actor = (...assignments: Assignment[]) => ({ personId: ME, assignments });
const mine = { createdByPersonId: ME, typeCode: "task" };
const theirs = { createdByPersonId: "p-other", typeCode: "task" };

describe("managesItem", () => {
  it("the creator manages their item — as an assignee too, whatever their hats (a student's own «تسک» included)", () => {
    for (const hats of [[orgAdmin], [principal], [teacher], [student], []]) {
      expect(managesItem(actor(...hats), mine, false)).toBe(true);
      expect(managesItem(actor(...hats), mine, true)).toBe(true);
    }
  });

  it("an assignee who did not create the item never manages it — not even with a broad `update` (the verifier's probe)", () => {
    for (const hats of [[orgAdmin], [principal], [branchVice], [principal, teacher], [teacher], [student]]) {
      expect(managesItem(actor(...hats), theirs, true)).toBe(false);
    }
  });

  it("the admin override: a broad `update` holder who is not an assignee manages anyone's item; nobody else does", () => {
    for (const hats of [[orgAdmin], [principal], [branchVice], [teacher, principal]]) expect(managesItem(actor(...hats), theirs, false)).toBe(true);
    // Scoped (teacher / student) or broad-but-read-only hats: no override.
    for (const hats of [[teacher], [student], [broadReader], []]) expect(managesItem(actor(...hats), theirs, false)).toBe(false);
  });

  it("«پیام ولی» (2026-10-19): its creator — the guardian — never manages it, whatever other hats they wear", () => {
    const sent = { createdByPersonId: ME, typeCode: "parent_message" };
    for (const hats of [[orgAdmin], [principal], [teacher], [student], []]) {
      expect(managesItem(actor(...hats), sent, false)).toBe(false);
      expect(managesItem(actor(...hats), sent, true)).toBe(false);
    }
    // Its addressees are assignees: never managers either (a principal answers, they do not close it for the others).
    expect(managesItem(actor(principal), { createdByPersonId: "p-guardian", typeCode: "parent_message" }, true)).toBe(false);
  });
});

describe("the type rules of «پیام ولی»", () => {
  it("closed by the first answer, which must carry text; its creator is no participant — every other type unchanged", () => {
    expect(closesOnFirstAnswer("parent_message")).toBe(true);
    expect(closesOnFirstAnswer("admin_request")).toBe(true);
    for (const t of ["task", "todo", "reminder", "approval"]) expect(closesOnFirstAnswer(t), t).toBe(false);
    expect(answerNeedsText("parent_message")).toBe(true);
    for (const t of ["admin_request", "task", "todo"]) expect(answerNeedsText(t), t).toBe(false);
    expect(creatorParticipates("parent_message")).toBe(false);
    for (const t of ["admin_request", "task", "todo", "reminder", "approval"]) expect(creatorParticipates(t), t).toBe(true);
  });
});
