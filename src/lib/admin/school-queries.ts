// The school hub (/admin/schools/[id]): what a school's own page still owns after the trim (docs/decisions.md
// «the hub drops sections that have their own door») — branches, academic years (name/dates/جاری only, no نوبت‌ها)
// and the ارائهٴ درس summary. زنگ‌بندی, کلاس‌ها, کارکنان and «کاتالوگ سازمان» each already have their own door
// (a Home tile or an admin nav section) and no longer duplicate it here. Each section's «افزودن» reuses the
// resource definition of the matching list page, so nothing here duplicates validation: the forms post to
// `adminResourceMutate` like everywhere else.
import { and, asc, desc, eq, count, sql } from "drizzle-orm";
import { z } from "zod";
import { defineQuery } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { assertSchoolInScope, getAdminScope } from "@/modules/iam/service";
import { findSchoolById } from "@/modules/tenancy/repo";
import { academicYear, branch, classGroup, classOffering } from "@/modules/tenancy/schema";
import { resourceOpGate, type AnyResourceDef, type ResourceOp } from "./defineResource";
import { schoolsLabelFa } from "./nav";
import { branchResource, schoolResource, yearResource } from "./resources";

export const SchoolIdInput = z.object({ schoolId: z.uuid("شناسه نامعتبر است.") }).strict();

export interface SchoolHubYear {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

export interface SchoolHubData {
  school: { id: string; name: string; code: string; genderPolicy: string | null; isDefault: boolean };
  branches: Array<{ id: string; name: string; address: string | null; isDefault: boolean }>;
  years: SchoolHubYear[];
  /** The year the header names: the current one, else the newest. No نوبت‌ها here — a school year is enough granularity for this page. */
  focusYear: SchoolHubYear | null;
  offerings: { total: number; withoutTeacher: number };
  can: { school: boolean; structure: boolean };
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

    const branches = await tx
      .select({ id: branch.id, name: branch.name, address: branch.address, isDefault: branch.isDefault })
      .from(branch)
      .where(eq(branch.schoolId, sch.id))
      .orderBy(desc(branch.isDefault), asc(branch.name));

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
      branches,
      years,
      focusYear: focus,
      offerings: { total: Number(offerings?.total ?? 0), withoutTeacher: Number(offerings?.withoutTeacher ?? 0) },
      can: { school: gate(schoolResource, "update"), structure: gate(branchResource, "create") && gate(yearResource, "create") },
      backLabelFa: schoolsLabelFa(scope),
    };
  },
);
