// Zod v4 `.strict()` inputs of the timetable and attendance actions and queries. Persian messages; nothing here
// is spread into a query — the services map fields explicitly.
import { z } from "zod";
import { MAX_PERIODS } from "@/lib/timetable";

const uuid = z.uuid("شناسه نامعتبر است.");

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

export const MyAttendanceInput = z.object({ from: isoDate.optional(), to: isoDate.optional() }).strict();
export type MyAttendanceInput = z.output<typeof MyAttendanceInput>;
