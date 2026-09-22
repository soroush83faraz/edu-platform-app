// The one line of context the desktop header carries on every page — «مدرسه · سال تحصیلی · نوبت» — read once per
// request (React `cache`) for the person's primary school: the current academic year and the term whose dates
// contain today (else the first term). Under RLS, explicit columns, any signed-in role (`iam.account.self`).
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { defineQuery } from "@/lib/actions";
import { academicYear, school, term } from "@/modules/tenancy/schema";

export interface ShellContext {
  schoolName: string | null;
  yearName: string | null;
  termName: string | null;
}

const shellContextQuery = defineQuery({ permission: "iam.account.self" }, async (tx): Promise<ShellContext> => {
  const [primary] = await tx.select({ id: school.id, name: school.name }).from(school).orderBy(desc(school.isDefault), asc(school.createdAt)).limit(1);
  if (!primary) return { schoolName: null, yearName: null, termName: null };
  const [year] = await tx
    .select({ id: academicYear.id, name: academicYear.name })
    .from(academicYear)
    .where(and(eq(academicYear.schoolId, primary.id), eq(academicYear.isCurrent, true)))
    .limit(1);
  if (!year) return { schoolName: primary.name, yearName: null, termName: null };
  const [current] = await tx
    .select({ name: term.name })
    .from(term)
    .where(eq(term.academicYearId, year.id))
    // The term containing today first, then the earliest — one row either way.
    .orderBy(sql`(${term.startsOn} <= current_date and ${term.endsOn} >= current_date) desc`, asc(term.sequence))
    .limit(1);
  return { schoolName: primary.name, yearName: year.name, termName: current?.name ?? null };
});

/** Cached per request: the header bar and the Home header share one read. Never throws — an error is an empty context. */
export const getShellContext = cache(async (): Promise<ShellContext> => {
  const r = await shellContextQuery();
  return r.ok ? r.data : { schoolName: null, yearName: null, termName: null };
});
