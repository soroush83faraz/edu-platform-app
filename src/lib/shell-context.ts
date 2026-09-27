// The one line of context the desktop header carries on every page — «مدرسه · سال تحصیلی · نوبت» — read once per
// request (React `cache`). For a student or a teacher that is the organization's primary school; for an ADMIN it is
// the schools of their own admin scope, and when that is more than one the header says «۲ مدرسه» and opens the list
// (owner, QA round 3: a two-school scope must never be represented by whichever school sorts first).
// The ORGANIZATION admin stands above every school (owner, 2026-09-27: «مدیر سازمان بالاتر از مدرسه است»): their
// context is the organization itself — `orgScoped`, no school name and no نوبت even when the organization has
// one school; `contextPlaceFa` (src/lib/context-place.ts) is the one rule every header/greeting/profile reads.
// Under RLS, explicit columns, any signed-in role (`iam.account.self`).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { cache } from "react";
import { defineQuery } from "@/lib/actions";
import { canAtAnyScope } from "@/modules/iam/can";
import { getAdminScope } from "@/modules/iam/service";
import { academicYear, school, term } from "@/modules/tenancy/schema";

export interface ShellContext {
  /** The caller's admin scope is the whole organization (the organization admin): the context is the organization. */
  orgScoped: boolean;
  /** The organization's name, carried for the organization admin's context bar (null only on a failed read). */
  orgName: string | null;
  /** The one school of the context; always null when `orgScoped` or when the scope holds several schools. */
  schoolName: string | null;
  yearName: string | null;
  termName: string | null;
  /** The schools of the caller's admin scope, listed only when there is more than one (else empty). */
  schools: Array<{ id: string; name: string }>;
}

const EMPTY: ShellContext = { orgScoped: false, orgName: null, schoolName: null, yearName: null, termName: null, schools: [] };

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
  const orgScoped = scope?.kind === "organization";
  const primary = schools[0];
  const base = { ...EMPTY, orgScoped, orgName: ctx.orgName };
  if (!primary) return base;
  // The organization admin, or two or more schools: no single school name and no single نوبت can stand for the
  // context — the organization (and «۲ مدرسه» when there are several) plus the year the schools share.
  if (orgScoped || (scope && schools.length > 1)) {
    const years = await tx
      .selectDistinct({ name: academicYear.name })
      .from(academicYear)
      .where(and(inArray(academicYear.schoolId, schools.map((s) => s.id)), eq(academicYear.isCurrent, true)));
    return { ...base, yearName: years.length === 1 ? years[0].name : null, schools: schools.length > 1 ? schools : [] };
  }
  // The current year and its نوبت in one statement: the term containing today first, then the earliest.
  const currentTerm = tx
    .select({ name: term.name })
    .from(term)
    .where(eq(term.academicYearId, academicYear.id))
    .orderBy(sql`(${term.startsOn} <= current_date and ${term.endsOn} >= current_date) desc`, asc(term.sequence))
    .limit(1);
  const [year] = await tx
    .select({ name: academicYear.name, termName: sql<string | null>`(${currentTerm})` })
    .from(academicYear)
    .where(and(eq(academicYear.schoolId, primary.id), eq(academicYear.isCurrent, true)))
    .limit(1);
  if (!year) return { ...base, schoolName: primary.name };
  return { ...base, schoolName: primary.name, yearName: year.name, termName: year.termName ?? null };
});

/** Cached per request: the header bar and the Home header share one read. Never throws — an error is an empty context. */
export const getShellContext = cache(async (): Promise<ShellContext> => {
  const r = await shellContextQuery();
  return r.ok ? r.data : EMPTY;
});
