// Who a کار change may notify (owner, round 7): nothing a student does reaches anyone; a personal item («خودم»)
// notifies no one; a دبیر's class homework and an admin's task to named people still do. Pure — no I/O. The
// service call sites are covered end to end in tests/int/workspace-service.test.ts.
import { describe, expect, it } from "vitest";
import type { AssignmentLike } from "@/lib/work-item-words";
import { actorMayNotify, creationNotifiable, notifiable } from "@/modules/workspace/notify-policy";

const WORK = ["workspace.work_item.read", "workspace.work_item.create", "workspace.work_item.update", "workspace.work_item.comment"];
const student: AssignmentLike = { roleCode: "student", scopeType: "student", permissions: WORK };
const teacher: AssignmentLike = { roleCode: "teacher", scopeType: "class_offering", permissions: [...WORK, "workspace.work_item.assign_class"] };
const principal: AssignmentLike = { roleCode: "school_principal", scopeType: "school", permissions: ["iam.admin.access", ...WORK] };

const OTHERS = ["p-1", "p-2"];

describe("actorMayNotify / notifiable", () => {
  it("a student's actions are silent for everyone (done, status, comment)", () => {
    expect(actorMayNotify([student])).toBe(false);
    expect(notifiable([student], OTHERS)).toEqual([]);
  });

  it("a دبیر and an admin still notify the people their action concerns", () => {
    expect(actorMayNotify([teacher])).toBe(true);
    expect(actorMayNotify([principal])).toBe(true);
    expect(notifiable([teacher], OTHERS)).toEqual(OTHERS);
    expect(notifiable([principal], OTHERS)).toEqual(OTHERS);
  });

  it("a student who also teaches acts as the دبیر (the student hat alone is what silences)", () => {
    expect(actorMayNotify([student, teacher])).toBe(true);
  });

  it("returns a copy, never the caller's array", () => {
    const out = notifiable([teacher], OTHERS);
    expect(out).not.toBe(OTHERS);
  });
});

describe("creationNotifiable", () => {
  it("a personal item («خودم») notifies no one, whoever opens it", () => {
    expect(creationNotifiable([student], "self", OTHERS)).toEqual([]);
    expect(creationNotifiable([teacher], "self", OTHERS)).toEqual([]);
    expect(creationNotifiable([principal], "self", OTHERS)).toEqual([]);
  });

  it("class homework from a دبیر notifies the class", () => {
    expect(creationNotifiable([teacher], "class_offering", OTHERS)).toEqual(OTHERS);
  });

  it("an admin's task to named people notifies them (kept: an assignment to someone else)", () => {
    expect(creationNotifiable([principal], "persons", OTHERS)).toEqual(OTHERS);
  });

  it("a student never notifies, whatever the recipients claim (the service refuses those anyway)", () => {
    expect(creationNotifiable([student], "class_offering", OTHERS)).toEqual([]);
    expect(creationNotifiable([student], "persons", OTHERS)).toEqual([]);
  });
});
