// The school hub (/admin/schools/[id]): a school's own management page — its آمار (کلاس‌ها/دانش‌آموزان/کارکنان,
// each a jump to its section below), سال تحصیلی (the fixed catalog, read-only), کلاس‌ها, کارکنان and دانش‌آموزان of
// this school (a compact list each + the door to the full filtered list), برنامهٴ زنگ‌بندی and the ارائهٴ درس
// summary. The people lists are the SAME queries as /admin/staff?school= and /admin/students?school= (first page).
import { and, desc, eq, count, sql } from "drizzle-orm";
import { z } from "zod";
import { defineQuery } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { assertSchoolInScope, getAdminScope } from "@/modules/iam/service";
import { findSchoolById } from "@/modules/tenancy/repo";
import { academicYear, branch, classGroup, classOffering } from "@/modules/tenancy/schema";
import { canAtAnyScope } from "@/modules/iam/can";
import { resourceOpGate, type AnyResourceDef, type ResourceOp } from "./defineResource";
import { schoolsLabelFa } from "./nav";
import { withSchoolCodeFor } from "./school-code";
import { oneSchoolCounts } from "./overview";
import { listStaff, listStudents, type StaffListRow, type StudentListRow } from "./people";
import { classResource, listClassRows, schoolResource } from "./resources";

/** How many people each hub section lists before «همه» — enough to recognise the school, short enough to scan. */
export const HUB_PEOPLE = 8;

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
  /** `code` only for the organization admin (`withSchoolCodeFor`): a principal's page never receives it. */
  school: { id: string; name: string; code?: string; genderPolicy: string | null; isDefault: boolean };
  /** آمار مدرسه — کلاس‌ها/دانش‌آموزان/کارکنان of THIS school (the stat row's numbers and doors). */
  counts: { classes: number; students: number; staff: number };
  years: SchoolHubYear[];
  /** This school's active classes (each links to its own page where students/ارائه/برنامه are managed). */
  classes: SchoolHubClass[];
  /** The year the header names: the current one, else the newest. No نوبت‌ها here — a school year is enough granularity for this page. */
  focusYear: SchoolHubYear | null;
  offerings: { total: number; withoutTeacher: number };
  /**
   * کارکنان / دانش‌آموزان of THIS school — the first `HUB_PEOPLE` rows of the same lists /admin/staff?school= and
   * /admin/students?school= show, with their totals. `null` when the caller may not read people (`iam.person.read`).
   */
  staff: { rows: StaffListRow[]; total: number } | null;
  students: { rows: StudentListRow[]; total: number } | null;
  can: { school: boolean; classes: boolean };
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

    // Staff = anchored to this school (`staff_profile.school_id`), students = enrolled in it — the `?school=` filters.
    const people = canAtAnyScope(ctx.assignments, "iam.person.read");
    const staff = people ? await listStaff(tx, scope, { q: "", page: 1, pageSize: HUB_PEOPLE, schoolId: sch.id }) : null;
    const students = people ? await listStudents(tx, scope, { q: "", page: 1, pageSize: HUB_PEOPLE, schoolId: sch.id }) : null;

    const gate = (def: AnyResourceDef, op: ResourceOp) => resourceOpGate(def, op, ctx.assignments, scope).ok;
    return {
      school: withSchoolCodeFor(scope, { id: sch.id, name: sch.name, code: sch.code, genderPolicy: sch.genderPolicy, isDefault: sch.isDefault }),
      // The stat row counts what its sections list, so a number and the list under it never disagree.
      counts: { ...counts, ...(staff ? { staff: staff.total } : {}), ...(students ? { students: students.total } : {}) },
      years,
      classes,
      focusYear: focus,
      offerings: { total: Number(offerings?.total ?? 0), withoutTeacher: Number(offerings?.withoutTeacher ?? 0) },
      staff,
      students,
      can: { school: gate(schoolResource, "update"), classes: gate(classResource, "create") },
      backLabelFa: schoolsLabelFa(scope),
    };
  },
);
