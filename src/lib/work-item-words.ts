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
// Round 6 adds a THIRD voice, `personal` — «تسک» — for a viewer whose only hat is `student`. The owner's rule
// is that a student now opens work FOR THEMSELVES, and that thing is a «تسک», never a «تکلیف». The voice
// therefore depends on the ITEM as well as the viewer, and the split is exactly this:
//
//   • where there IS an item, the item decides: a `task` given by a دبیر or by the school still reads
//     «تکلیف» for the student who received it (`workItemVoice` is unchanged, so their کارتابل, their
//     notifications and the detail page are untouched), while a personal `todo` reads «تسک»
//     (`personalItemLabel`);
//   • where there is NO item yet — the Home creation tile, the «تسک جدید» button, the create form — the
//     VIEWER decides (`createVoice` / `voiceForHats`), because the only thing a student can open is their own تسک.
//
// This is a PURE function of the request context's assignments (`ctx.assignments`), so a page pays no query for
// it. Routes, permission codes, type codes (`task` / `todo`), DB values and audit actions are untouched — only
// rendered strings. A page renders in the READER's word; what the service writes (its Persian errors, and the
// notification rows stored once for many readers) is in the ACTOR's word — the word the item's own author used
// (docs/workspace.md «واژهٴ نقش‌محور»).
//
// Unit-tested in `tests/unit/work-item-words.test.ts`.

/** «تکلیف» (a teacher's homework), «تسک» (staff work an admin hands out), or a student's own «تسک». */
export type WorkItemVoice = "assignment" | "task" | "personal";

/** The shape `Ctx.assignments` already has — structural on purpose, so this file imports nothing. */
export interface AssignmentLike {
  scopeType: string;
  permissions: readonly string[];
  /** Only the student hat is told apart by its role code (`ctx.assignments` carries it); the rest go by permission. */
  roleCode?: string;
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
  /** Who gets it: a teacher gives to «دانش‌آموزان», an admin to «گیرندگان», a student to «خودم». */
  recipients: string;
  /** What a PERSONAL item (type `todo`) is called: «یادداشت شخصی», or a student's «تسک». */
  selfNoun: string;
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
    selfNoun: "یادداشت شخصی",
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
    selfNoun: "یادداشت شخصی",
  },
  // The student's own voice. The same noun as the admin's — «تسک» is simply the word for work that is not
  // homework — but everything round it is personal: the example is their own revision, the recipient is «خودم».
  personal: {
    singular: "تسک",
    plural: "تسک‌ها",
    indefinite: "تسکی",
    new: "تسک جدید",
    given: "تسک‌های داده‌شده",
    mine: "تسک‌های من",
    titleExample: "مثلاً: مرور فصل ۳",
    recipients: "خودم",
    selfNoun: "تسک",
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

/** «تکلیف» unless the viewer is an admin who does NOT teach — then «تسک». The word of an ITEM one holds. */
export function workItemVoice(assignments: readonly AssignmentLike[]): WorkItemVoice {
  if (hasTeachingHat(assignments)) return "assignment";
  return assignments.some((a) => a.permissions.includes(ADMIN_PERMISSION)) ? "task" : "assignment";
}

/** Wears the student hat and nothing that hands work to anyone else — the one person whose new کار is a «تسک». */
export function isStudentOnly(assignments: readonly AssignmentLike[]): boolean {
  if (hasTeachingHat(assignments)) return false;
  if (assignments.some((a) => a.permissions.includes(ADMIN_PERMISSION))) return false;
  return assignments.some((a) => a.roleCode === "student");
}

/**
 * The word for a کار the viewer is ABOUT to open: a student's own is a «تسک»; everyone else keeps the word they
 * read on their items. This — not `workItemVoice` — is what the create form, the «تسک جدید» button and the
 * Home creation tile speak in.
 */
export function createVoice(assignments: readonly AssignmentLike[]): WorkItemVoice {
  return isStudentOnly(assignments) ? "personal" : workItemVoice(assignments);
}

/**
 * The visible name of a PERSONAL item (type `todo`) for this reader: a student's own is «تسک»; for everyone
 * else the catalog's own name («کار شخصی») stands, exactly as before. `voice` is the reader's `createVoice`.
 */
export function personalItemLabel(voice: WorkItemVoice, typeName: string): string {
  return voice === "personal" ? WORDS.personal.singular : typeName;
}

/** The noun set of a voice; `workItemWords(workItemVoice(ctx.assignments))` is the whole rule. */
export function workItemWords(voice: WorkItemVoice): WorkItemWords {
  return WORDS[voice];
}

// ---------------------------------------------------------------------------------------------------------------
// the Home grid's creation tile
// ---------------------------------------------------------------------------------------------------------------

/** The hats the tile registry already computes from `getHats` (`TileHats` in src/lib/modules-registry). */
export interface HatsLike {
  isTeacher: boolean;
  isAdmin: boolean;
  isStudent?: boolean;
}

/** The same rule as `createVoice`, read off the hats a surface has already resolved. */
export function voiceForHats(hats: HatsLike): WorkItemVoice {
  if (hats.isTeacher) return "assignment";
  if (hats.isAdmin) return "task";
  return hats.isStudent ? "personal" : "assignment";
}

export function workItemWordsForHats(hats: HatsLike): WorkItemWords {
  return workItemWords(voiceForHats(hats));
}

/**
 * The label of Home's one creation tile: «تکلیف جدید» for a teacher, «تسک جدید» for an admin who does not
 * teach — and «تسک جدید» for a student, whose one کار is the personal one they open for themselves (round 6).
 */
export function newItemLabel(hats: HatsLike): string {
  return workItemWordsForHats(hats).new;
}

/** Who sees the creation tile: every hat that may open a کار (`workspace.work_item.create` still decides). */
export const NEW_ITEM_TILE_ROLES = ["teacher", "admin", "student"] as const;

/** Who sees its mirror, «… داده‌شده»: only the hats that hand work to OTHER people — never the student. */
export const GIVEN_TILE_ROLES = ["teacher", "admin"] as const;

/**
 * The visible name of a status row. The catalog's «کنسل‌شده» reads «حذف‌شده» in the UI (owner, round 4): the
 * creator action is «حذف» now. Nothing is deleted — the stored status code is still `cancelled`, the transition
 * and the audit row are unchanged, and «بازگشایی» brings the item back.
 */
export function workItemStatusLabel(name: string): string {
  return name === "کنسل‌شده" ? "حذف‌شده" : name;
}
