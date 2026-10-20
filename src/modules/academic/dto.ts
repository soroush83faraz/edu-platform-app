// Zod v4 `.strict()` inputs of the timetable and attendance actions and queries. Persian messages; nothing here
// is spread into a query — the services map fields explicitly.
import { z } from "zod";
import { MAX_PERIODS } from "@/lib/timetable";

const uuid = z.uuid("گزینهٴ انتخاب‌شده نامعتبر است.");

export const ClassGroupIdInput = z.object({ classGroupId: uuid }).strict();
export type ClassGroupIdInput = z.output<typeof ClassGroupIdInput>;

export const SchoolIdInput = z.object({ schoolId: uuid }).strict();
export type SchoolIdInput = z.output<typeof SchoolIdInput>;

export const OfferingIdInput = z.object({ offeringId: uuid }).strict();
export type OfferingIdInput = z.output<typeof OfferingIdInput>;

export const SetTimetableSlotInput = z
  .object({
    classGroupId: uuid,
    weekday: z.number("روز هفته نامعتبر است.").int().min(0, "روز هفته نامعتبر است.").max(5, "روز هفته نامعتبر است."),
    periodNo: z.number("شمارهٴ زنگ نامعتبر است.").int().min(1, "شمارهٴ زنگ نامعتبر است.").max(MAX_PERIODS, "شمارهٴ زنگ نامعتبر است."),
    /** null / empty = clear the cell. */
    classOfferingId: z.preprocess((v) => (v === "" ? null : v), uuid.nullable()),
    room: z.string().trim().max(40, "نام اتاق حداکثر ۴۰ نویسه است.").nullable().optional(),
  })
  .strict();
export type SetTimetableSlotInput = z.output<typeof SetTimetableSlotInput>;

const time = z.string().trim().min(1, "ساعت را وارد کنید.").max(8);

export const SetSchoolPeriodsInput = z
  .object({
    schoolId: uuid,
    periods: z
      .array(
        z
          .object({
            periodNo: z.number().int().min(1).max(MAX_PERIODS),
            label: z.string().trim().min(1, "نام زنگ را وارد کنید.").max(40, "نام زنگ حداکثر ۴۰ نویسه است."),
            startsAt: time,
            endsAt: time,
          })
          .strict(),
      )
      .min(1, "دست‌کم یک زنگ لازم است.")
      .max(MAX_PERIODS, "حداکثر ۱۲ زنگ ممکن است."),
  })
  .strict();
export type SetSchoolPeriodsInput = z.output<typeof SetSchoolPeriodsInput>;

// ---------------------------------------------------------------------------------------------------------------
// attendance («حضور و غیاب»)
// ---------------------------------------------------------------------------------------------------------------

/** A PostgreSQL `date` on the wire: ISO `YYYY-MM-DD` (the pages build it from the Tehran calendar). */
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است.");

/** `""` / `"none"` from a form select = the daily roll call (no زنگ). */
const periodNo = z.preprocess(
  (v) => (v === "" || v === "none" || v === null ? null : typeof v === "string" ? Number(v) : v),
  z.number("شمارهٴ زنگ نامعتبر است.").int().min(1, "شمارهٴ زنگ نامعتبر است.").max(MAX_PERIODS, "شمارهٴ زنگ نامعتبر است.").nullable(),
);

export const AttendanceStatusEnum = z.enum(["present", "absent", "late", "excused"], { error: "وضعیت حضور و غیاب نامعتبر است." });

export const TakeAttendanceInput = z
  .object({
    classGroupId: uuid,
    date: isoDate,
    periodNo: periodNo.optional(),
    classOfferingId: uuid.nullable().optional(),
    note: z.string().trim().max(300, "یادداشت حداکثر ۳۰۰ نویسه است.").nullable().optional(),
    entries: z
      .array(
        z
          .object({
            studentProfileId: uuid,
            status: AttendanceStatusEnum,
            minutesLate: z.number().int().min(0).max(600, "دقیقهٴ تأخیر حداکثر ۶۰۰ است.").nullable().optional(),
            note: z.string().trim().max(300, "یادداشت حداکثر ۳۰۰ نویسه است.").nullable().optional(),
          })
          .strict(),
      )
      .min(1, "فهرست دانش‌آموزان خالی است.")
      .max(300, "این فهرست بیش از حد بزرگ است."),
  })
  .strict();
export type TakeAttendanceInput = z.output<typeof TakeAttendanceInput>;

export const AttendanceCellInput = z.object({ classGroupId: uuid, date: isoDate, periodNo: periodNo.optional() }).strict();
export type AttendanceCellInput = z.output<typeof AttendanceCellInput>;

export const StudentAttendanceInput = z.object({ studentProfileId: uuid, from: isoDate, to: isoDate }).strict();
export type StudentAttendanceInput = z.output<typeof StudentAttendanceInput>;

export const ClassAttendanceInput = z.object({ classGroupId: uuid, from: isoDate, to: isoDate }).strict();
export type ClassAttendanceInput = z.output<typeof ClassAttendanceInput>;

/** The admin report's optional school filter (`/admin/attendance?school=`); the service checks it against the admin scope. */
export const AttendanceReportInput = z.object({ schoolId: uuid.optional() }).strict();
export type AttendanceReportInput = z.output<typeof AttendanceReportInput>;

export const MyAttendanceInput = z.object({ from: isoDate.optional(), to: isoDate.optional() }).strict();
export type MyAttendanceInput = z.output<typeof MyAttendanceInput>;

// ---------------------------------------------------------------------------------------------------------------
// «کارنامهٴ توصیفی» (descriptive report card, migration 0017)
// ---------------------------------------------------------------------------------------------------------------

export const ObjectiveRatingEnum = z.enum(["very_good", "good", "acceptable", "needs_effort"], { error: "سطح ارزشیابی نامعتبر است." });

/** A Jalali month 1..12 (7 = مهر). */
const jalaliMonth = z.number("ماه نامعتبر است.").int("ماه نامعتبر است.").min(1, "ماه نامعتبر است.").max(12, "ماه نامعتبر است.");
const subjectName = z.string("درس را انتخاب کنید.").trim().min(1, "درس را انتخاب کنید.").max(60, "نام درس نامعتبر است.");

/** One sheet: a class × month × درس (the entry roster). */
export const ReportSheetInput = z.object({ classGroupId: uuid, month: jalaliMonth, subjectName }).strict();
export type ReportSheetInput = z.output<typeof ReportSheetInput>;

/** «ثبت کارنامه»: the whole sheet in ONE action; `rating: null` clears a rating. */
export const SaveObjectiveRatingsInput = z
  .object({
    classGroupId: uuid,
    month: jalaliMonth,
    subjectName,
    entries: z
      .array(z.object({ studentProfileId: uuid, learningObjectiveId: uuid, rating: ObjectiveRatingEnum.nullable() }).strict())
      .min(1, "چیزی برای ثبت نیست.")
      .max(5000, "این فهرست بیش از حد بزرگ است."),
  })
  .strict();
export type SaveObjectiveRatingsInput = z.output<typeof SaveObjectiveRatingsInput>;

/** The class page / «کارنامهٴ کلاس» of one month (month omitted = the month the page opens on). */
export const ReportClassInput = z.object({ classGroupId: uuid, month: jalaliMonth.optional() }).strict();
export type ReportClassInput = z.output<typeof ReportClassInput>;

/** The printable report cards of a class (every student, or one). */
export const ReportPrintInput = z.object({ classGroupId: uuid, month: jalaliMonth, studentProfileId: uuid.optional() }).strict();
export type ReportPrintInput = z.output<typeof ReportPrintInput>;

/** «کارنامهٴ من». */
export const MyReportCardInput = z.object({ month: jalaliMonth.optional() }).strict();
export type MyReportCardInput = z.output<typeof MyReportCardInput>;

// ---------------------------------------------------------------------------------------------------------------
// «دفتر کلاسی — گزارش جلسه» (migration 0027)
// ---------------------------------------------------------------------------------------------------------------

const reportPeriodNo = z.number("شمارهٴ زنگ نامعتبر است.").int("شمارهٴ زنگ نامعتبر است.").min(1, "شمارهٴ زنگ نامعتبر است.").max(MAX_PERIODS, "شمارهٴ زنگ نامعتبر است.");

/** One session = the roll call's cell: a class on a date at a زنگ (a report always has a زنگ — unlike the daily roll call). */
export const SessionReportCellInput = z.object({ classGroupId: uuid, date: isoDate, periodNo: reportPeriodNo }).strict();
export type SessionReportCellInput = z.output<typeof SessionReportCellInput>;

/**
 * «ذخیرهٴ گزارش جلسه»: the lengths mirror the CHECKs of `academic.session_report`. The درس is NOT trusted from the
 * client unless named — then the service validates it against the class, exactly like the roll call; the author is
 * always the session's person.
 */
export const SaveSessionReportInput = z
  .object({
    classGroupId: uuid,
    date: isoDate,
    periodNo: reportPeriodNo,
    classOfferingId: uuid.nullable().optional(),
    topic: z.string("موضوع تدریس‌شده را بنویسید.").trim().min(1, "موضوع تدریس‌شده را بنویسید.").max(200, "موضوع تدریس‌شده حداکثر ۲۰۰ نویسه است."),
    pageRef: z.string().trim().max(100, "صفحه یا فصل حداکثر ۱۰۰ نویسه است.").nullable().optional(),
    /** `""` from the form's «بدون تکلیف» option = none. */
    workItemId: z.preprocess((v) => (v === "" ? null : v), uuid.nullable().optional()),
    privateNote: z.string().trim().max(1000, "یادداشت دبیر حداکثر ۱۰۰۰ نویسه است.").nullable().optional(),
    nextPlan: z.string().trim().max(300, "برنامهٴ جلسهٴ بعد حداکثر ۳۰۰ نویسه است.").nullable().optional(),
  })
  .strict();
export type SaveSessionReportInput = z.output<typeof SaveSessionReportInput>;
