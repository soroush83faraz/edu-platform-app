// The empty states of the کارتابل, Home's «تکالیف نزدیک» and «اعلان‌ها», in the READER's own voice (UX review
// 2026-09-27, owner): a student is spoken to as «تو», staff as «شما»; each line names the context and the next
// step instead of a generic «داده‌ای نیست». The noun follows `work-item-words` — «تکلیف» for a student and a دبیر,
// «تسک» for an admin who does not teach. Pure strings, unit-tested in tests/unit/empty-copy.test.ts.
import { type AssignmentLike, hasTeachingHat, isStudentOnly } from "@/lib/work-item-words";

/** Who is reading: the voice (تو / شما) and the next step both follow from it. */
export type Audience = "student" | "teacher" | "admin" | "member";

const ADMIN_PERMISSION = "iam.admin.access";

export function audienceOf(assignments: readonly AssignmentLike[]): Audience {
  if (isStudentOnly(assignments)) return "student";
  if (hasTeachingHat(assignments)) return "teacher";
  if (assignments.some((a) => a.permissions.includes(ADMIN_PERMISSION))) return "admin";
  return "member";
}

export interface EmptyCopy {
  title: string;
  description: string;
}

/**
 * Nothing open in the کارتابل (and nothing on Home's «تکالیف نزدیک»). `canCreate` decides whether the next step is
 * to write one; `firstTime` (nothing finished either — the کارتابل knows it from its tab counts) lets a دبیر read
 * «هنوز تکلیفی نداده‌اید», which would be untrue once they have given some.
 */
export function emptyOpenCopy(audience: Audience, canCreate: boolean, firstTime = false): EmptyCopy {
  switch (audience) {
    case "student":
      return { title: "فعلاً تکلیفی نداری.", description: "هر وقت دبیر تکلیف بدهد، همین‌جا و در اعلان‌ها خبرت می‌کنیم." };
    case "teacher":
      if (canCreate && firstTime) return { title: "هنوز تکلیفی نداده‌اید.", description: "اولین تکلیف را برای کلاس‌تان بنویسید؛ پیشرفت دانش‌آموزان همین‌جا دیده می‌شود." };
      return canCreate
        ? { title: "تکلیف بازی ندارید.", description: "تکلیف تازه‌ای برای کلاس‌تان بنویسید؛ پیشرفت دانش‌آموزان همین‌جا دیده می‌شود." }
        : { title: "تکلیفی در جریان نیست.", description: "هر وقت تکلیفی به شما داده شود، همین‌جا و در اعلان‌ها خبرتان می‌کنیم." };
    case "admin":
      return canCreate
        ? { title: "تسکی در جریان نیست.", description: "اولین تسک را برای همکاران‌تان بنویسید؛ پیشرفتش همین‌جا دیده می‌شود." }
        : { title: "تسکی در انتظار شما نیست.", description: "هر وقت تسکی به شما داده شود، همین‌جا و در اعلان‌ها خبرتان می‌کنیم." };
    case "member":
      return { title: "تکلیفی در انتظار شما نیست.", description: "هر وقت مدرسه تکلیفی بدهد، همین‌جا و در اعلان‌ها خبرتان می‌کنیم." };
  }
}

/** The «انجام‌شده» tab with nothing in it. */
export function emptyDoneCopy(audience: Audience): EmptyCopy {
  switch (audience) {
    case "student":
      return { title: "هنوز تکلیفی را تمام نکرده‌ای.", description: "هر تکلیفی را که انجام‌شده علامت بزنی، این‌جا می‌ماند." };
    case "admin":
      return { title: "هنوز تسکی تمام نشده.", description: "تسک‌های تمام‌شده این‌جا می‌مانند تا هر وقت خواستید دوباره ببینید." };
    default:
      return { title: "هنوز تکلیفی تمام نشده.", description: "تکالیف تمام‌شده این‌جا می‌مانند تا هر وقت خواستید دوباره ببینید." };
  }
}

/** «اعلان‌ها» with no notification at all. */
export function emptyNotificationsCopy(audience: Audience): EmptyCopy {
  switch (audience) {
    case "student":
      return { title: "هنوز اعلانی نداری.", description: "هر وقت دبیر تکلیف تازه‌ای بدهد یا برایت نظری بنویسد، همین‌جا خبرت می‌کنیم." };
    case "teacher":
      return { title: "هنوز اعلانی ندارید.", description: "هر وقت دانش‌آموزی تکلیفی را انجام بدهد یا نظری بنویسد، همین‌جا خبرتان می‌کنیم." };
    case "admin":
      return { title: "هنوز اعلانی ندارید.", description: "هر وقت تسکی به شما داده شود یا کسی روی تسک‌هایتان نظری بنویسد، همین‌جا خبرتان می‌کنیم." };
    case "member":
      return { title: "هنوز اعلانی ندارید.", description: "هر وقت تکلیفی به شما داده شود یا نظر تازه‌ای برسد، همین‌جا خبرتان می‌کنیم." };
  }
}
