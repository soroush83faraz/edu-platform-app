// The school hub (/admin/schools/[id]): a school's own management page — its آمار (کلاس‌ها/دانش‌آموزان/کارکنان,
// each a door to that school's filtered list), سال تحصیلی, کلاس‌ها of this school, برنامهٔ زنگ‌بندی and the ارائهٴ
// درس summary. Every «افزودن» reuses the resource definition of the matching list page, so nothing here duplicates
// validation: the forms post to `adminResourceMutate` like everywhere else.
import { and, desc, eq, count, sql } from "drizzle-orm";
import { z } from "zod";
import { defineQuery } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { assertSchoolInScope, getAdminScope } from "@/modules/iam/service";
import { findSchoolById } from "@/modules/tenancy/repo";
import { academicYear, branch, classGroup, classOffering } from "@/modules/tenancy/schema";
import { resourceOpGate, type AnyResourceDef, type ResourceOp } from "./defineResource";
import { schoolsLabelFa } from "./nav";
import { oneSchoolCounts } from "./overview";
import { classResource, listClassRows, schoolResource, yearResource } from "./resources";

export const SchoolIdInput = z.object({ schoolId: z.uuid("شناسه نامعتبر است.") }).strict();

export interface SchoolHubYear {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

export interface SchoolHubClass {
  id: string;
  name: string;
  gradeName: string;
  yearName: string;
  students: number;
}

export interface SchoolHubData {
  school: { id: string; name: string; code: string; genderPolicy: string | null; isDefault: boolean };
  /** آمار مدرسه — کلاس‌ها/دانش‌آموزان/کارکنان of THIS school (the stat row's numbers and doors). */
  counts: { classes: number; students: number; staff: number };
  years: SchoolHubYear[];
  /** This school's active classes (each links to its own page where students/ارائه/برنامه are managed). */
  classes: SchoolHubClass[];
  /** The year the header names: the current one, else the newest. No نوبت‌ها here — a school year is enough granularity for this page. */
  focusYear: SchoolHubYear | null;
  offerings: { total: number; withoutTeacher: number };
  can: { school: boolean; structure: boolean; classes: boolean };
  /** «مدرسه» / «مدرسه‌ها» — what the list this page came from is called for THIS caller (`schoolsLabelFa`). */
  backLabelFa: string;
}

/**
 * Gate: `tenancy.structure.read` at any scope (organization admin, principal, vice principal) + the scope rule —
 * a school outside the caller's scope is NOT_FOUND, exactly like the list page's rows. The «افزودن» buttons are
 * rendered from the same `resourceOpGate` the mutation action applies, never from the caller's role.
 */
export const schoolHubQuery = defineQuery<SchoolHubData, typeof SchoolIdInput>(
  { schema: SchoolIdInput, permission: "tenancy.structure.read", scope: "any" },
  async (tx, input, ctx) => {
    const scope = await getAdminScope(tx, ctx);
    assertSchoolInScope(scope, input.schoolId);
    const sch = await findSchoolById(tx, input.schoolId);
    if (!sch) throw notFound();

    const years: SchoolHubYear[] = await tx
      .select({
        id: academicYear.id,
        name: academicYear.name,
        startsOn: academicYear.startsOn,
        endsOn: academicYear.endsOn,
        isCurrent: academicYear.isCurrent,
      })
      .from(academicYear)
      .where(eq(academicYear.schoolId, sch.id))
      .orderBy(desc(academicYear.isCurrent), desc(academicYear.startsOn));
    const focus = years.find((y) => y.isCurrent) ?? years[0] ?? null;

    const counts = await oneSchoolCounts(tx, sch.id);
    const classRows = await listClassRows(tx, scope, { schoolId: sch.id });
    const classes: SchoolHubClass[] = classRows.rows.map((c) => ({ id: c.id, name: c.name, gradeName: c.gradeName, yearName: c.yearName, students: c.students }));

    const [offerings] = await tx
      .select({
        total: count(classOffering.id),
        withoutTeacher: sql<number>`(count(*) filter (where not exists (select 1 from academic.teacher_assignment ta where ta.class_offering_id = ${classOffering.id} and ta.valid_to is null)))::int`,
      })
      .from(classOffering)
      .innerJoin(classGroup, eq(classGroup.id, classOffering.classGroupId))
      .innerJoin(branch, eq(branch.id, classGroup.branchId))
      .where(and(eq(branch.schoolId, sch.id), eq(classGroup.status, "active"), sql`${classOffering.status} <> 'closed'`));

    const gate = (def: AnyResourceDef, op: ResourceOp) => resourceOpGate(def, op, ctx.assignments, scope).ok;
    return {
      school: { id: sch.id, name: sch.name, code: sch.code, genderPolicy: sch.genderPolicy, isDefault: sch.isDefault },
      counts,
      years,
      classes,
      focusYear: focus,
      offerings: { total: Number(offerings?.total ?? 0), withoutTeacher: Number(offerings?.withoutTeacher ?? 0) },
      can: { school: gate(schoolResource, "update"), structure: gate(yearResource, "create"), classes: gate(classResource, "create") },
      backLabelFa: schoolsLabelFa(scope),
    };
  },
);
