// The visible noun of a کار is a pure function of the viewer's hats — «تکلیف» for a teacher, «تسک» for an admin
// who does not teach, «تکلیف» for someone wearing both. No I/O.
import { describe, expect, it } from "vitest";
import { type AssignmentLike, NEW_ITEM_TILE_ROLES, hasTeachingHat, newItemLabel, workItemStatusLabel, workItemVoice, workItemWords } from "@/lib/work-item-words";

const WORK_ITEM_ALL = ["workspace.work_item.read", "workspace.work_item.create", "workspace.work_item.update", "workspace.work_item.comment", "workspace.work_item.assign_class"];

const teacher: AssignmentLike = { scopeType: "class_offering", permissions: WORK_ITEM_ALL };
const teacherOfGroup: AssignmentLike = { scopeType: "class_group", permissions: WORK_ITEM_ALL };
const principal: AssignmentLike = { scopeType: "school", permissions: ["iam.admin.access", "iam.person.read", ...WORK_ITEM_ALL] };
const orgAdmin: AssignmentLike = { scopeType: "organization", permissions: ["iam.admin.access", ...WORK_ITEM_ALL] };
const vicePrincipal: AssignmentLike = { scopeType: "branch", permissions: ["iam.admin.access", ...WORK_ITEM_ALL] };
const student: AssignmentLike = { scopeType: "student", permissions: ["workspace.work_item.read", "workspace.work_item.update", "workspace.work_item.comment"] };

describe("workItemVoice", () => {
  it("a teacher (class_offering or class_group scope) reads «تکلیف»", () => {
    expect(workItemVoice([teacher])).toBe("assignment");
    expect(workItemVoice([teacherOfGroup])).toBe("assignment");
  });

  it("مدیر سازمان / مدیر مدرسه / معاون read «تسک»", () => {
    expect(workItemVoice([orgAdmin])).toBe("task");
    expect(workItemVoice([principal])).toBe("task");
    expect(workItemVoice([vicePrincipal])).toBe("task");
  });

  it("BOTH hats read «تکلیف» — a principal who teaches a class is acting as a teacher there", () => {
    expect(workItemVoice([principal, teacher])).toBe("assignment");
    expect(workItemVoice([teacher, orgAdmin])).toBe("assignment");
  });

  it("a student, a guardian and an empty context keep «تکلیف»", () => {
    expect(workItemVoice([student])).toBe("assignment");
    expect(workItemVoice([])).toBe("assignment");
  });

  it("an admin permission at a class scope is still the admin word — the teaching hat needs assign_class", () => {
    expect(workItemVoice([{ scopeType: "class_offering", permissions: ["iam.admin.access", "workspace.work_item.read"] }])).toBe("task");
  });

  it("a class-scoped assignment without assign_class is no teaching hat", () => {
    expect(hasTeachingHat([{ scopeType: "class_offering", permissions: ["workspace.work_item.read"] }])).toBe(false);
    expect(hasTeachingHat([teacher])).toBe(true);
    // A broad assign_class (an admin's) is not a teaching hat either — that is the «تسک» side of the rule.
    expect(hasTeachingHat([principal])).toBe(false);
  });
});

describe("workItemWords", () => {
  it("the recipients word follows the hat", () => {
    expect(workItemWords("assignment").recipients).toBe("دانش‌آموزان");
    expect(workItemWords("task").recipients).toBe("گیرندگان");
  });

  it("the assignment set", () => {
    expect(workItemWords("assignment")).toMatchObject({ singular: "تکلیف", plural: "تکالیف", indefinite: "تکلیفی", new: "تکلیف جدید", given: "تکالیف داده‌شده", mine: "تکالیف من" });
  });

  it("the task set uses نیم‌فاصله in the plurals", () => {
    const w = workItemWords("task");
    expect(w).toMatchObject({ singular: "تسک", plural: "تسک‌ها", indefinite: "تسکی", new: "تسک جدید", given: "تسک‌های داده‌شده", mine: "تسک‌های من" });
  });

  it("no Latin letters and no empty string in either set", () => {
    for (const voice of ["assignment", "task"] as const) {
      for (const value of Object.values(workItemWords(voice))) {
        expect(value.length).toBeGreaterThan(0);
        expect(value).not.toMatch(/[A-Za-z]/);
      }
    }
  });
});

describe("newItemLabel (the Home creation tile)", () => {
  it("follows the same rule as the pages", () => {
    expect(newItemLabel({ isTeacher: true, isAdmin: false })).toBe("تکلیف جدید");
    expect(newItemLabel({ isTeacher: true, isAdmin: true })).toBe("تکلیف جدید");
    expect(newItemLabel({ isTeacher: false, isAdmin: true })).toBe("تسک جدید");
    expect(newItemLabel({ isTeacher: false, isAdmin: false })).toBe("تکلیف جدید");
  });

  it("the tile belongs to both hats that may create one", () => {
    expect([...NEW_ITEM_TILE_ROLES]).toEqual(["teacher", "admin"]);
  });
});

describe("workItemStatusLabel", () => {
  it("«کنسل‌شده» is shown as «حذف‌شده» (the stored code stays `cancelled`)", () => {
    expect(workItemStatusLabel("کنسل‌شده")).toBe("حذف‌شده");
  });

  it("every other status name is untouched", () => {
    for (const name of ["باز", "در حال انجام", "انجام‌شده"]) expect(workItemStatusLabel(name)).toBe(name);
  });
});
