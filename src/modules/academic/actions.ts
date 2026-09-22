"use server";
// academic Server Actions: the timetable editor's cell save, the bell-schedule editor and the roll call. They go through
// defineAction with `scope: "any"` and let the service decide the scope INSIDE the transaction (out of scope =
// NOT_FOUND, never FORBIDDEN — the class/school must look nonexistent; docs/admin.md «قانون دامنه»).
import { defineAction } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { can } from "@/modules/iam/can";
import { getAdminScope, assertSchoolInScope } from "@/modules/iam/service";
import { setSchoolPeriods } from "@/modules/tenancy/service";
import { takeAttendance } from "./attendance";
import { SetSchoolPeriodsInput, SetTimetableSlotInput, TakeAttendanceInput } from "./dto";
import { setTimetableSlot } from "./service";

export const setTimetableSlotAction = defineAction({ schema: SetTimetableSlotInput, permission: "academic.timetable.write", scope: "any" }, async (tx, input, ctx) =>
  setTimetableSlot(tx, ctx, { classGroupId: input.classGroupId, weekday: input.weekday, periodNo: input.periodNo, classOfferingId: input.classOfferingId, room: input.room ?? null }),
);

/** زنگ‌بندی is structure: `tenancy.structure.write` at the school (org admin, principal); the vice principal reads only. */
export const setSchoolPeriodsAction = defineAction({ schema: SetSchoolPeriodsInput, permission: "tenancy.structure.write", scope: "any" }, async (tx, input, ctx) => {
  assertSchoolInScope(await getAdminScope(tx, ctx), input.schoolId);
  if (!(await can(tx, ctx, "tenancy.structure.write", { scopeType: "school", id: input.schoolId }))) throw notFound();
  return setSchoolPeriods(tx, ctx, input.schoolId, input.periods);
});

/**
 * «ثبت حضور و غیاب» — one roll call (upsert). `scope: "any"` as everywhere in this module: the service decides
 * the real scope INSIDE the transaction (the class for an admin, the درس of that زنگ for its teacher) and answers
 * NOT_FOUND when neither holds. Nothing from the client reaches a query unmapped.
 */
export const takeAttendanceAction = defineAction({ schema: TakeAttendanceInput, permission: "academic.attendance.write", scope: "any" }, async (tx, input, ctx) =>
  takeAttendance(tx, ctx, {
    classGroupId: input.classGroupId,
    date: input.date,
    periodNo: input.periodNo ?? null,
    classOfferingId: input.classOfferingId ?? null,
    note: input.note ?? null,
    entries: input.entries.map((e) => ({ studentProfileId: e.studentProfileId, status: e.status, minutesLate: e.minutesLate ?? null, note: e.note ?? null })),
  }),
);
