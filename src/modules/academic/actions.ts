"use server";
// academic Server Actions: the timetable editor's cell save and the bell-schedule editor. Both go through
// defineAction with `scope: "any"` and let the service decide the scope INSIDE the transaction (out of scope =
// NOT_FOUND, never FORBIDDEN — the class/school must look nonexistent; docs/admin.md «قانون دامنه»).
import { defineAction } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { can } from "@/modules/iam/can";
import { getAdminScope, assertSchoolInScope } from "@/modules/iam/service";
import { setSchoolPeriods } from "@/modules/tenancy/service";
import { SetSchoolPeriodsInput, SetTimetableSlotInput } from "./dto";
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
