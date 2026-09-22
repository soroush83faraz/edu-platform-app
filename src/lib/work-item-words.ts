// The visible noun of a `workspace.work_item`, chosen by the hats the VIEWER wears (owner's rule, round 4):
//
//   • a teaching hat — a role assignment carrying `workspace.work_item.assign_class` at a class_offering /
//     class_group scope — reads «تکلیف»: what a teacher gives a class is homework;
//   • otherwise a holder of `iam.admin.access` (مدیر سازمان / مدیر مدرسه / معاون) reads «تسک»: they hand work to
//     staff, not homework to students;
//   • BOTH hats → «تکلیف». A principal who also teaches a class is acting as a teacher whenever she opens a کار
//     for a class, and the class word is the one her students will read on the same item;
//   • anyone else (a student, a guardian) keeps «تکلیف» — the word on the item they were given.
//
// This is a PURE function of the request context's assignments (`ctx.assignments`), so a page pays no query for
// it. Routes, permission codes, type codes (`task` / `todo`), DB values and audit actions are untouched — only
// rendered strings. A page renders in the READER's word; what the service writes (its Persian errors, and the
// notification rows stored once for many readers) is in the ACTOR's word — the word the item's own author used
// (docs/workspace.md «واژهٴ نقش‌محور»).
//
// Unit-tested in `tests/unit/work-item-words.test.ts`.

/** «تکلیف» (a teacher's homework) or «تسک» (staff work an admin hands out). */
export type WorkItemVoice = "assignment" | "task";

/** The shape `Ctx.assignments` already has — structural on purpose, so this file imports nothing. */
export interface AssignmentLike {
  scopeType: string;
  permissions: readonly string[];
}

export interface WorkItemWords {
  /** «تکلیف» / «تسک» */
  singular: string;
  /** «تکالیف» / «تسک‌ها» */
  plural: string;
  /** The indefinite («تکلیفی در انتظار شما نیست»): «تکلیفی» / «تسکی». */
  indefinite: string;
  /** «تکلیف جدید» / «تسک جدید» */
  new: string;
  /** «تکالیف داده‌شده» / «تسک‌های داده‌شده» */
  given: string;
  /** «تکالیف من» / «تسک‌های من» */
  mine: string;
  /** The «عنوان» example of the create form — homework for a class, staff work for an admin. */
  titleExample: string;
  /** Who gets it, in the confirmations: a teacher gives to «دانش‌آموزان», an admin to «گیرندگان». */
  recipients: string;
}

const WORDS: Record<WorkItemVoice, WorkItemWords> = {
  assignment: {
    singular: "تکلیف",
    plural: "تکالیف",
    indefinite: "تکلیفی",
    new: "تکلیف جدید",
    given: "تکالیف داده‌شده",
    mine: "تکالیف من",
    titleExample: "مثلاً: تمرین صفحهٴ ۴۲",
    recipients: "دانش‌آموزان",
  },
  task: {
    singular: "تسک",
    plural: "تسک‌ها",
    indefinite: "تسکی",
    new: "تسک جدید",
    given: "تسک‌های داده‌شده",
    mine: "تسک‌های من",
    titleExample: "مثلاً: تحویل گزارش ماهانه",
    recipients: "گیرندگان",
  },
};

/** The scopes a teaching role lives at (`teacher.allowedScopeTypes` in `scripts/catalog.ts`). */
const TEACHING_SCOPE_TYPES: readonly string[] = ["class_offering", "class_group"];
const TEACHING_PERMISSION = "workspace.work_item.assign_class";
const ADMIN_PERMISSION = "iam.admin.access";

/** May give work to a class through a class-scoped role — the teacher hat, whatever else the person also holds. */
export function hasTeachingHat(assignments: readonly AssignmentLike[]): boolean {
  return assignments.some((a) => TEACHING_SCOPE_TYPES.includes(a.scopeType) && a.permissions.includes(TEACHING_PERMISSION));
}

/** «تکلیف» unless the viewer is an admin who does NOT teach — then «تسک». */
export function workItemVoice(assignments: readonly AssignmentLike[]): WorkItemVoice {
  if (hasTeachingHat(assignments)) return "assignment";
  return assignments.some((a) => a.permissions.includes(ADMIN_PERMISSION)) ? "task" : "assignment";
}

/** The noun set of a voice; `workItemWords(workItemVoice(ctx.assignments))` is the whole rule. */
export function workItemWords(voice: WorkItemVoice): WorkItemWords {
  return WORDS[voice];
}

/**
 * The visible name of a status row. The catalog's «کنسل‌شده» reads «حذف‌شده» in the UI (owner, round 4): the
 * creator action is «حذف» now. Nothing is deleted — the stored status code is still `cancelled`, the transition
 * and the audit row are unchanged, and «بازگشایی» brings the item back.
 */
export function workItemStatusLabel(name: string): string {
  return name === "کنسل‌شده" ? "حذف‌شده" : name;
}
