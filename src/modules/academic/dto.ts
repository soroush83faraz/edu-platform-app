// Zod v4 `.strict()` inputs of the timetable actions and queries. Persian messages; nothing here is spread into
// a query — the services map fields explicitly.
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
