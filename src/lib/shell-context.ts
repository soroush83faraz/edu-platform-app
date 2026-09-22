// The one line of context the desktop header carries on every page — «مدرسه · سال تحصیلی · نوبت» — read once per
// request (React `cache`). For a student or a teacher that is the organization's primary school; for an ADMIN it is
// the schools of their own admin scope, and when that is more than one the header says «۲ مدرسه» and opens the list
// (owner, QA round 3: a two-school scope must never be represented by whichever school sorts first).
// Under RLS, explicit columns, any signed-in role (`iam.account.self`).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { cache } from "react";
import { defineQuery } from "@/lib/actions";
import { canAtAnyScope } from "@/modules/iam/can";
import { getAdminScope } from "@/modules/iam/service";
import { academicYear, school, term } from "@/modules/tenancy/schema";

export interface ShellContext {
  schoolName: string | null;
  yearName: string | null;
  termName: string | null;
  /** The schools of the caller's admin scope, listed only when there is more than one (else empty). */
  schools: Array<{ id: string; name: string }>;
}

const EMPTY: ShellContext = { schoolName: null, yearName: null, termName: null, schools: [] };

const shellContextQuery = defineQuery({ permission: "iam.account.self" }, async (tx, _input, ctx): Promise<ShellContext> => {
  // An admin's context follows their scope; everyone else keeps the organization's primary school.
  // (`getAdminScope` refuses an admin permission with no scope at all; the header must not break over that.)
  const scope = canAtAnyScope(ctx.assignments, "iam.admin.access") ? await getAdminScope(tx, ctx).catch(() => null) : null;
  const schools = await tx
    .select({ id: school.id, name: school.name })
    .from(school)
    .where(scope && scope.kind === "school" ? inArray(school.id, scope.schoolIds) : undefined)
    .orderBy(desc(school.isDefault), asc(school.createdAt))
    .limit(20);
  const primary = schools[0];
  if (!primary) return EMPTY;
  // Two or more schools: no single name and no single نوبت can stand for them — «۲ مدرسه» plus the year they share.
  if (scope && schools.length > 1) {
    const years = await tx
      .selectDistinct({ name: academicYear.name })
      .from(academicYear)
      .where(and(inArray(academicYear.schoolId, schools.map((s) => s.id)), eq(academicYear.isCurrent, true)));
    return { schoolName: null, yearName: years.length === 1 ? years[0].name : null, termName: null, schools };
  }
  const [year] = await tx
    .select({ id: academicYear.id, name: academicYear.name })
    .from(academicYear)
    .where(and(eq(academicYear.schoolId, primary.id), eq(academicYear.isCurrent, true)))
    .limit(1);
  if (!year) return { ...EMPTY, schoolName: primary.name };
  const [current] = await tx
    .select({ name: term.name })
    .from(term)
    .where(eq(term.academicYearId, year.id))
    // The term containing today first, then the earliest — one row either way.
    .orderBy(sql`(${term.startsOn} <= current_date and ${term.endsOn} >= current_date) desc`, asc(term.sequence))
    .limit(1);
  return { schoolName: primary.name, yearName: year.name, termName: current?.name ?? null, schools: [] };
});

/** Cached per request: the header bar and the Home header share one read. Never throws — an error is an empty context. */
export const getShellContext = cache(async (): Promise<ShellContext> => {
  const r = await shellContextQuery();
  return r.ok ? r.data : EMPTY;
});
