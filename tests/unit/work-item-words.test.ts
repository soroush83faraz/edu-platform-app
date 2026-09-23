// The visible noun of a کار is a pure function of the viewer's hats — «تکلیف» for a teacher, «تسک» for an admin
// who does not teach, «تکلیف» for someone wearing both — and, since round 6, «تسک» for what a STUDENT opens
// for themselves, while the تکالیف they were given keep their name. No I/O.
import { describe, expect, it } from "vitest";
import {
  type AssignmentLike,
  GIVEN_TILE_ROLES,
  NEW_ITEM_TILE_ROLES,
  createVoice,
  hasTeachingHat,
  isStudentOnly,
  newItemLabel,
  personalItemLabel,
  workItemStatusLabel,
  workItemVoice,
  workItemWords,
} from "@/lib/work-item-words";

const WORK_ITEM_ALL = ["workspace.work_item.read", "workspace.work_item.create", "workspace.work_item.update", "workspace.work_item.comment", "workspace.work_item.assign_class"];

const teacher: AssignmentLike = { scopeType: "class_offering", permissions: WORK_ITEM_ALL };
const teacherOfGroup: AssignmentLike = { scopeType: "class_group", permissions: WORK_ITEM_ALL };
const principal: AssignmentLike = { scopeType: "school", permissions: ["iam.admin.access", "iam.person.read", ...WORK_ITEM_ALL] };
const orgAdmin: AssignmentLike = { scopeType: "organization", permissions: ["iam.admin.access", ...WORK_ITEM_ALL] };
const vicePrincipal: AssignmentLike = { scopeType: "branch", permissions: ["iam.admin.access", ...WORK_ITEM_ALL] };
const student: AssignmentLike = {
  roleCode: "student",
  scopeType: "student",
  permissions: ["workspace.work_item.read", "workspace.work_item.create", "workspace.work_item.update", "workspace.work_item.comment"],
};

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

  it("no Latin letters and no empty string in any set", () => {
    for (const voice of ["assignment", "task", "personal"] as const) {
      for (const value of Object.values(workItemWords(voice))) {
        expect(value.length).toBeGreaterThan(0);
        expect(value).not.toMatch(/[A-Za-z]/);
      }
    }
  });
});

describe("the student's own «تسک» (round 6)", () => {
  it("a student alone gets the personal voice — any other hat outranks it", () => {
    expect(isStudentOnly([student])).toBe(true);
    expect(createVoice([student])).toBe("personal");
    // A student who also teaches, or who is also staff, is no longer «only» a student.
    expect(isStudentOnly([student, teacher])).toBe(false);
    expect(isStudentOnly([student, principal])).toBe(false);
    expect(createVoice([student, teacher])).toBe("assignment");
    expect(createVoice([student, orgAdmin])).toBe("task");
    // No student hat at all: unchanged.
    expect(isStudentOnly([])).toBe(false);
    expect(createVoice([])).toBe("assignment");
    expect(createVoice([teacher])).toBe("assignment");
  });

  it("the personal set: «تسک» for their own work, «خودم» as the recipient", () => {
    expect(workItemWords("personal")).toMatchObject({
      singular: "تسک",
      plural: "تسک‌ها",
      new: "تسک جدید",
      mine: "تسک‌های من",
      recipients: "خودم",
      selfNoun: "تسک",
    });
    expect(workItemWords("personal").titleExample).toContain("مرور فصل");
  });

  it("an item GIVEN to a student is still «تکلیف» — only the item they open themselves is a «تسک»", () => {
    // The کارتابل, the notifications and the detail page all read `workItemVoice`, which never changed.
    expect(workItemVoice([student])).toBe("assignment");
    expect(workItemWords(workItemVoice([student])).singular).toBe("تکلیف");
    // A personal row (type `todo`) is the one the student reads as «تسک»; everyone else keeps the catalog name.
    expect(personalItemLabel(createVoice([student]), "کار شخصی")).toBe("تسک");
    expect(personalItemLabel(createVoice([teacher]), "کار شخصی")).toBe("کار شخصی");
    expect(personalItemLabel(createVoice([orgAdmin]), "کار شخصی")).toBe("کار شخصی");
  });
});

describe("newItemLabel (the Home creation tile)", () => {
  it("follows the same rule as the pages", () => {
    expect(newItemLabel({ isTeacher: true, isAdmin: false })).toBe("تکلیف جدید");
    expect(newItemLabel({ isTeacher: true, isAdmin: true })).toBe("تکلیف جدید");
    expect(newItemLabel({ isTeacher: false, isAdmin: true })).toBe("تسک جدید");
    expect(newItemLabel({ isTeacher: false, isAdmin: false })).toBe("تکلیف جدید");
    expect(newItemLabel({ isTeacher: false, isAdmin: false, isStudent: true })).toBe("تسک جدید");
    // A student who teaches (a rare double hat) gives homework, so the teaching word wins there too.
    expect(newItemLabel({ isTeacher: true, isAdmin: false, isStudent: true })).toBe("تکلیف جدید");
  });

  it("the creation tile belongs to every hat that may open a کار; its mirror only to those who give one", () => {
    expect([...NEW_ITEM_TILE_ROLES]).toEqual(["teacher", "admin", "student"]);
    expect([...GIVEN_TILE_ROLES]).toEqual(["teacher", "admin"]);
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
