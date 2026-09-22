// Read-only queries for pages (Server Components). Same gate as actions: session → must-change → permission.
import { defineQuery } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { can } from "@/modules/iam/can";
import { assertSchoolInScope, getAdminScope } from "@/modules/iam/service";
import { findSchoolById, listSchoolPeriods } from "@/modules/tenancy/repo";
import { ClassGroupIdInput, OfferingIdInput, SchoolIdInput } from "./dto";
import { getMyClass } from "./repo";
import { getClassTimetable, getMyTimetable, getOfferingPage } from "./service";

export type { MyClass, MyClassTeacher } from "./repo";
export type { ClassTimetable, DayPlan, MyTimetable, OfferingPage, Session, TimetableOffering } from "./service";

/** «کلاس من» of the signed-in student (null without an active enrollment). Personal read — checked at any scope. */
export const myClassQuery = defineQuery({ permission: "workspace.work_item.read", scope: "any" }, async (tx, _input, ctx) => getMyClass(tx, ctx.personId));

/** «برنامهٴ من»: the student's class timetable and/or the teacher's sessions, with today and the ringing زنگ. */
export const myTimetableQuery = defineQuery({ permission: "academic.timetable.read", scope: "any" }, async (tx, _input, ctx) => getMyTimetable(tx, ctx));

/** The grid of one class for the admin editor (`/admin/classes/[id]/timetable`); out of scope = NOT_FOUND. */
export const classTimetableQuery = defineQuery({ schema: ClassGroupIdInput, permission: "academic.timetable.read", scope: "any" }, async (tx, input, ctx) =>
  getClassTimetable(tx, ctx, input.classGroupId),
);

/** The subject page (`/subjects/[offeringId]`): the offering's facts, its sessions and the viewer's relation to it. */
export const offeringPageQuery = defineQuery({ schema: OfferingIdInput, permission: "academic.timetable.read", scope: "any" }, async (tx, input, ctx) =>
  getOfferingPage(tx, ctx, input.offeringId),
);

/** زنگ‌بندی of one school for the admin editor; `canEdit` = structure write (org admin, principal). */
export const schoolPeriodsQuery = defineQuery(
  { schema: SchoolIdInput, permission: "iam.admin.access", scope: "any" },
  async (tx, input, ctx) => {
    const scope = await getAdminScope(tx, ctx);
    assertSchoolInScope(scope, input.schoolId);
    const school = await findSchoolById(tx, input.schoolId);
    if (!school) throw notFound();
    const canEdit = await can(tx, ctx, "tenancy.structure.write", { scopeType: "school", id: school.id });
    return { school: { id: school.id, name: school.name }, periods: await listSchoolPeriods(tx, school.id), canEdit };
  },
);
