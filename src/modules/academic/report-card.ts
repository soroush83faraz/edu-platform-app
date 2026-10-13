// academic/report-card — «کارنامهٴ توصیفی» of primary school (پایه ۱–۶): each month the class's آموزگار rates every
// student on that month's learning objectives per درس with one of four levels (src/lib/objective-rating.ts). Same
// shape as attendance: `(tx, ctx, input)` inside the caller's tenant transaction, explicit column selects, `audit()`
// in the one mutation, and every scope decision INSIDE the transaction — out of scope is NOT_FOUND, never FORBIDDEN.
//
// The scope rule (owner, 2026-10-13): a report card belongs to a CLASS. Admins (org admin, principal, vice) hold
// `academic.objective_rating.*` at the school, so `can(..., class_group)` answers for them; a teacher holds it at
// their `class_offering`, and ANY open offering of the class lets them rate the WHOLE class — in دبستان one آموزگار
// teaches everything, and a درس with its own teacher (ورزش, قرآن) may rate too. A student reads their OWN profile
// (`can(..., student)`). Anything else — a teacher of another class, the principal of another school, another
// tenant (RLS) — is NOT_FOUND.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { tehranToday } from "@/lib/attendance";
import { notFound, validation } from "@/lib/errors";
import { tehranJalaliMonth } from "@/lib/format";
import { defaultReportMonth, emptyRatingCounts, isObjectiveRating, isSheetComplete, tallyRatings, type ObjectiveRating, type RatingCounts } from "@/lib/objective-rating";
import { can, canPure } from "@/modules/iam/can";
import type { Permission } from "@/modules/iam/permissions";
import { jalaliMonthName, schoolMonthIndex, subjectOrder, type ObjectiveDomain } from "./primary-objectives";
import { findClassOfStudentProfile, findStudentProfile, listClassRoster } from "./repo";
import { objectiveRating } from "./schema";
import type { TimetableCtx } from "./service";

export type ReportCtx = TimetableCtx;
type RatingPermission = Extract<Permission, "academic.objective_rating.read" | "academic.objective_rating.write">;

export const REPORT_CARD_MESSAGES = {
  noObjectives: "برای این درس در این ماه هدفی ثبت نشده است.",
  objectiveNotInSheet: "این هدف به این درس و این ماه تعلق ندارد.",
  notInRoster: "برای کسی که در این کلاس ثبت‌نام فعال ندارد نمی‌توان کارنامه ثبت کرد.",
  duplicate: "برای یک دانش‌آموز و یک هدف دو سطح فرستاده شده است.",
} as const;

function fail(field: string, message: string): never {
  throw validation({ fieldErrors: { [field]: [message] } }, message);
}

// ---------------------------------------------------------------------------------------------------------------
// the class and the scope
// ---------------------------------------------------------------------------------------------------------------

export interface ReportClass {
  id: string;
  name: string;
  schoolId: string;
  schoolName: string;
  branchId: string;
  academicYearId: string;
  academicYearName: string;
  gradeLevelId: string;
  gradeName: string;
}

async function findReportClass(tx: Tx, classGroupId: string): Promise<ReportClass | null> {
  const res = await tx.execute<{
    id: string;
    name: string;
    school_id: string;
    school_name: string;
    branch_id: string;
    academic_year_id: string;
    academic_year_name: string;
    grade_level_id: string;
    grade_name: string;
  }>(sql`
    select cg.id, cg.name, b.school_id, s.name as school_name, cg.branch_id, cg.academic_year_id, ay.name as academic_year_name,
      cg.grade_level_id, gl.name as grade_name
    from tenancy.class_group cg
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.school s on s.id = b.school_id
    join tenancy.academic_year ay on ay.id = cg.academic_year_id
    join tenancy.grade_level gl on gl.id = cg.grade_level_id
    where cg.id = ${classGroupId}::uuid
    limit 1`);
  const r = res.rows[0];
  return r
    ? {
        id: r.id,
        name: r.name,
        schoolId: r.school_id,
        schoolName: r.school_name,
        branchId: r.branch_id,
        academicYearId: r.academic_year_id,
        academicYearName: r.academic_year_name,
        gradeLevelId: r.grade_level_id,
        gradeName: r.grade_name,
      }
    : null;
}

async function openOfferingIds(tx: Tx, classGroupId: string): Promise<string[]> {
  const res = await tx.execute<{ id: string }>(sql`select o.id from tenancy.class_offering o where o.class_group_id = ${classGroupId}::uuid and o.status <> 'closed'`);
  return res.rows.map((r) => r.id);
}

/** Holds `permission` at the class (admins, a class-scoped teacher) or at ANY open offering of it (its teachers)? */
export async function classAccess(tx: Tx, ctx: ReportCtx, classGroupId: string, permission: RatingPermission): Promise<boolean> {
  if (await can(tx, ctx, permission, { scopeType: "class_group", id: classGroupId })) return true;
  const offerings = await openOfferingIds(tx, classGroupId);
  return offerings.some((id) => canPure(ctx.assignments, [{ scopeType: "class_offering", id }], permission));
}

// ---------------------------------------------------------------------------------------------------------------
// objectives of a پایه
// ---------------------------------------------------------------------------------------------------------------

export interface ObjectiveRow {
  id: string;
  month: number;
  subjectName: string;
  subjectId: string | null;
  domain: ObjectiveDomain | null;
  text: string;
  sortOrder: number;
}

async function listObjectives(tx: Tx, gradeLevelId: string, month: number | null): Promise<ObjectiveRow[]> {
  const monthFilter = month === null ? sql`true` : sql`lo.month = ${month}`;
  const res = await tx.execute<{ id: string; month: number; subject_name: string; subject_id: string | null; domain: string | null; text: string; sort_order: number }>(sql`
    select lo.id, lo.month, lo.subject_name, lo.subject_id, lo.domain, lo.text, lo.sort_order
    from academic.learning_objective lo
    where lo.grade_level_id = ${gradeLevelId}::uuid and lo.status = 'active' and ${monthFilter}
    order by lo.month, lo.subject_name, lo.sort_order`);
  return res.rows
    .map((r) => ({ id: r.id, month: Number(r.month), subjectName: r.subject_name, subjectId: r.subject_id, domain: (r.domain as ObjectiveDomain | null) ?? null, text: r.text, sortOrder: Number(r.sort_order) }))
    .sort((a, b) => schoolMonthIndex(a.month) - schoolMonthIndex(b.month) || subjectOrder(a.subjectName) - subjectOrder(b.subjectName) || a.subjectName.localeCompare(b.subjectName, "fa") || a.sortOrder - b.sortOrder);
}

/** Months (school-year order) in which the پایه has objectives. */
async function availableMonths(tx: Tx, gradeLevelId: string): Promise<number[]> {
  const res = await tx.execute<{ month: number }>(sql`
    select distinct lo.month from academic.learning_objective lo where lo.grade_level_id = ${gradeLevelId}::uuid and lo.status = 'active'`);
  return res.rows.map((r) => Number(r.month)).sort((a, b) => schoolMonthIndex(a) - schoolMonthIndex(b));
}

export interface SubjectGroup {
  name: string;
  /** The organisation's درس row when one matches (hue / glyph key); null otherwise. */
  subjectId: string | null;
  objectives: ObjectiveRow[];
}

function groupBySubject(objectives: readonly ObjectiveRow[]): SubjectGroup[] {
  const out: SubjectGroup[] = [];
  for (const o of objectives) {
    let g = out.find((x) => x.name === o.subjectName);
    if (!g) out.push((g = { name: o.subjectName, subjectId: o.subjectId, objectives: [] }));
    g.objectives.push(o);
  }
  return out;
}

/** Ratings of `students` × `objectiveIds` in one academic year, as `student → objective → rating`. */
async function ratingsOf(tx: Tx, academicYearId: string, studentIds: readonly string[], objectiveIds: readonly string[]): Promise<Map<string, Map<string, ObjectiveRating>>> {
  const out = new Map<string, Map<string, ObjectiveRating>>();
  if (studentIds.length === 0 || objectiveIds.length === 0) return out;
  const rows = await tx
    .select({ studentProfileId: objectiveRating.studentProfileId, learningObjectiveId: objectiveRating.learningObjectiveId, rating: objectiveRating.rating })
    .from(objectiveRating)
    .where(and(eq(objectiveRating.academicYearId, academicYearId), inArray(objectiveRating.studentProfileId, [...studentIds]), inArray(objectiveRating.learningObjectiveId, [...objectiveIds])));
  for (const r of rows) {
    if (!isObjectiveRating(r.rating)) continue;
    let m = out.get(r.studentProfileId);
    if (!m) out.set(r.studentProfileId, (m = new Map()));
    m.set(r.learningObjectiveId, r.rating);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// classes the caller may open (the «کارنامهٴ توصیفی» picker, and Home's tile)
// ---------------------------------------------------------------------------------------------------------------

export interface RatableClass {
  id: string;
  name: string;
  schoolName: string;
  gradeName: string;
  students: number;
  canWrite: boolean;
}

/**
 * Active classes whose پایه has learning objectives and that the caller may READ (with `canWrite` per class): an
 * admin's schools, a teacher's classes, nothing for a student. Decided with `canPure` over each class's scope chain
 * (class → branch → school → organisation) and its open offerings — one query, no per-class round trips.
 */
export async function listRatableClasses(tx: Tx, ctx: ReportCtx): Promise<RatableClass[]> {
  const res = await tx.execute<{ id: string; name: string; branch_id: string; school_id: string; school_name: string; grade_name: string; grade_seq: number; students: number; offering_ids: string[] | null }>(sql`
    select cg.id, cg.name, cg.branch_id, b.school_id, s.name as school_name, gl.name as grade_name, gl.sequence as grade_seq,
      (select count(*)::int from academic.class_enrollment ce where ce.class_group_id = cg.id and ce.status = 'active') as students,
      (select array_agg(o.id) from tenancy.class_offering o where o.class_group_id = cg.id and o.status <> 'closed') as offering_ids
    from tenancy.class_group cg
    join tenancy.branch b on b.id = cg.branch_id
    join tenancy.school s on s.id = b.school_id
    join tenancy.grade_level gl on gl.id = cg.grade_level_id
    where cg.status = 'active'
      and exists (select 1 from academic.learning_objective lo where lo.grade_level_id = cg.grade_level_id and lo.status = 'active')
    order by s.name, gl.sequence, cg.name`);
  const out: RatableClass[] = [];
  for (const r of res.rows) {
    const chain = [
      { scopeType: "class_group" as const, id: r.id },
      { scopeType: "branch" as const, id: r.branch_id },
      { scopeType: "school" as const, id: r.school_id },
      { scopeType: "organization" as const, id: ctx.orgId },
    ];
    const offerings = r.offering_ids ?? [];
    const holds = (p: RatingPermission) => canPure(ctx.assignments, chain, p) || offerings.some((id) => canPure(ctx.assignments, [{ scopeType: "class_offering", id }], p));
    if (!holds("academic.objective_rating.read")) continue;
    out.push({ id: r.id, name: r.name, schoolName: r.school_name, gradeName: r.grade_name, students: Number(r.students), canWrite: holds("academic.objective_rating.write") });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// the entry sheet (class × month × درس)
// ---------------------------------------------------------------------------------------------------------------

export interface SheetRow {
  studentProfileId: string;
  fullName: string;
  studentNumber: string | null;
  /** objective id → rating (missing = not rated yet). */
  ratings: Record<string, ObjectiveRating>;
}

export interface RatingSheet {
  classGroup: ReportClass;
  month: number;
  monthName: string;
  subjectName: string;
  subjectId: string | null;
  objectives: ObjectiveRow[];
  rows: SheetRow[];
  /** Students with every objective of the sheet rated. */
  complete: number;
  canWrite: boolean;
  /** The last save of this sheet («آخرین ثبت …»). */
  saved: { at: Date; byName: string | null } | null;
}

/**
 * The roster of one sheet with every saved rating pre-filled. Read scope: `academic.objective_rating.read` at the
 * class or any of its open offerings; `canWrite` the same with `.write`. A درس without objectives that month gives
 * an empty `objectives` (the page shows the empty state naming the پایه and month).
 */
export async function getRatingSheet(tx: Tx, ctx: ReportCtx, input: { classGroupId: string; month: number; subjectName: string }): Promise<RatingSheet> {
  const cg = await findReportClass(tx, input.classGroupId);
  if (!cg) throw notFound();
  if (!(await classAccess(tx, ctx, cg.id, "academic.objective_rating.read"))) throw notFound();
  const canWrite = await classAccess(tx, ctx, cg.id, "academic.objective_rating.write");
  const objectives = (await listObjectives(tx, cg.gradeLevelId, input.month)).filter((o) => o.subjectName === input.subjectName);
  const roster = await listClassRoster(tx, cg.id, tehranToday());
  const ratings = await ratingsOf(
    tx,
    cg.academicYearId,
    roster.map((r) => r.studentProfileId),
    objectives.map((o) => o.id),
  );
  const ids = objectives.map((o) => o.id);
  const rows: SheetRow[] = roster.map((s) => ({
    studentProfileId: s.studentProfileId,
    fullName: s.fullName,
    studentNumber: s.studentNumber,
    ratings: Object.fromEntries(ratings.get(s.studentProfileId) ?? []),
  }));
  let saved: RatingSheet["saved"] = null;
  if (ids.length > 0 && rows.length > 0) {
    const res = await tx.execute<{ rated_at: Date; first_name: string | null; last_name: string | null }>(sql`
      select r.rated_at, p.first_name, p.last_name
      from academic.objective_rating r
      left join iam.person p on p.id = r.rated_by_person_id
      where r.academic_year_id = ${cg.academicYearId}::uuid
        and r.learning_objective_id = any(${sql.param(ids, undefined)}::uuid[])
        and r.student_profile_id = any(${sql.param(rows.map((x) => x.studentProfileId), undefined)}::uuid[])
      order by r.rated_at desc
      limit 1`);
    const r = res.rows[0];
    if (r) saved = { at: new Date(r.rated_at), byName: r.first_name ? `${r.first_name} ${r.last_name ?? ""}`.trim() : null };
  }
  return {
    classGroup: cg,
    month: input.month,
    monthName: jalaliMonthName(input.month),
    subjectName: input.subjectName,
    subjectId: objectives[0]?.subjectId ?? null,
    objectives,
    rows,
    complete: rows.filter((r) => isSheetComplete(ids, r.ratings)).length,
    canWrite,
    saved,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// «ثبت کارنامه» — one sheet in one transaction
// ---------------------------------------------------------------------------------------------------------------

export interface SaveRatingsInput {
  classGroupId: string;
  month: number;
  subjectName: string;
  entries: Array<{ studentProfileId: string; learningObjectiveId: string; rating: ObjectiveRating | null }>;
}

export interface SaveRatingsResult {
  /** Ratings written (new or changed). */
  set: number;
  /** Ratings removed (`rating: null` on a rated pair). */
  cleared: number;
  unchanged: number;
  /** Students of the class with the whole sheet rated after this save. */
  complete: number;
  students: number;
}

/**
 * Upserts one sheet: every (student, objective) pair sent with a level is written — inserted, or updated when it
 * changed (`ON CONFLICT` on the natural key, so two teachers saving at once never duplicate) — and a pair sent with
 * `null` loses its rating (DELETE). Validates that every objective is an ACTIVE objective of this class's پایه for
 * that month and درس, and every student has an active enrollment in the class. One audit row
 * (`academic.objective_rating.saved`) carries each change with its old and new level; a save that changes
 * nothing writes nothing. Write scope: `academic.objective_rating.write` at the class or any of its open offerings.
 */
export async function saveObjectiveRatings(tx: Tx, ctx: ReportCtx, input: SaveRatingsInput): Promise<SaveRatingsResult> {
  const cg = await findReportClass(tx, input.classGroupId);
  if (!cg) throw notFound();
  if (!(await classAccess(tx, ctx, cg.id, "academic.objective_rating.write"))) throw notFound();
  const objectives = (await listObjectives(tx, cg.gradeLevelId, input.month)).filter((o) => o.subjectName === input.subjectName);
  if (objectives.length === 0) fail("subjectName", REPORT_CARD_MESSAGES.noObjectives);
  const objectiveIds = new Set(objectives.map((o) => o.id));
  const roster = await listClassRoster(tx, cg.id, tehranToday());
  const inRoster = new Set(roster.map((r) => r.studentProfileId));

  const seen = new Set<string>();
  for (const e of input.entries) {
    if (!objectiveIds.has(e.learningObjectiveId)) fail("entries", REPORT_CARD_MESSAGES.objectiveNotInSheet);
    if (!inRoster.has(e.studentProfileId)) fail("entries", REPORT_CARD_MESSAGES.notInRoster);
    const key = `${e.studentProfileId}:${e.learningObjectiveId}`;
    if (seen.has(key)) fail("entries", REPORT_CARD_MESSAGES.duplicate);
    seen.add(key);
  }

  const students = [...new Set(input.entries.map((e) => e.studentProfileId))];
  const existing = await tx
    .select({ id: objectiveRating.id, studentProfileId: objectiveRating.studentProfileId, learningObjectiveId: objectiveRating.learningObjectiveId, rating: objectiveRating.rating })
    .from(objectiveRating)
    .where(and(eq(objectiveRating.academicYearId, cg.academicYearId), inArray(objectiveRating.studentProfileId, students), inArray(objectiveRating.learningObjectiveId, [...objectiveIds])))
    .for("update");
  const prevOf = new Map(existing.map((r) => [`${r.studentProfileId}:${r.learningObjectiveId}`, r]));

  const writes: Array<{ studentProfileId: string; learningObjectiveId: string; rating: ObjectiveRating }> = [];
  const clears: string[] = [];
  const changes: Array<{ studentProfileId: string; learningObjectiveId: string; from: string | null; to: ObjectiveRating | null }> = [];
  let unchanged = 0;
  for (const e of input.entries) {
    const prev = prevOf.get(`${e.studentProfileId}:${e.learningObjectiveId}`);
    if (e.rating === null) {
      if (prev) {
        clears.push(prev.id);
        changes.push({ studentProfileId: e.studentProfileId, learningObjectiveId: e.learningObjectiveId, from: prev.rating, to: null });
      } else unchanged++;
      continue;
    }
    if (prev?.rating === e.rating) {
      unchanged++;
      continue;
    }
    writes.push({ studentProfileId: e.studentProfileId, learningObjectiveId: e.learningObjectiveId, rating: e.rating });
    changes.push({ studentProfileId: e.studentProfileId, learningObjectiveId: e.learningObjectiveId, from: prev?.rating ?? null, to: e.rating });
  }

  if (writes.length > 0) {
    await tx
      .insert(objectiveRating)
      .values(
        writes.map((w) => ({
          organizationId: ctx.orgId,
          academicYearId: cg.academicYearId,
          studentProfileId: w.studentProfileId,
          learningObjectiveId: w.learningObjectiveId,
          rating: w.rating,
          ratedByPersonId: ctx.personId,
        })),
      )
      .onConflictDoUpdate({
        target: [objectiveRating.organizationId, objectiveRating.academicYearId, objectiveRating.studentProfileId, objectiveRating.learningObjectiveId],
        set: { rating: sql`excluded.rating`, ratedByPersonId: sql`excluded.rated_by_person_id`, ratedAt: sql`now()` },
      });
  }
  if (clears.length > 0) await tx.delete(objectiveRating).where(inArray(objectiveRating.id, clears));

  if (changes.length > 0) {
    await audit(
      ctx,
      "academic.objective_rating.saved",
      { schema: "academic", table: "objective_rating", id: null },
      null,
      { classGroupId: cg.id, academicYearId: cg.academicYearId, month: input.month, subjectName: input.subjectName, set: writes.length, cleared: clears.length, changes },
      tx,
    );
  }

  // Completion after the save (what the page's progress line shows).
  const after = await ratingsOf(
    tx,
    cg.academicYearId,
    roster.map((r) => r.studentProfileId),
    [...objectiveIds],
  );
  const ids = [...objectiveIds];
  const complete = roster.filter((r) => isSheetComplete(ids, Object.fromEntries(after.get(r.studentProfileId) ?? []))).length;
  return { set: writes.length, cleared: clears.length, unchanged, complete, students: roster.length };
}

// ---------------------------------------------------------------------------------------------------------------
// the class's month: درس‌ها with progress + a summary row per student («کارنامهٴ کلاس»)
// ---------------------------------------------------------------------------------------------------------------

export interface ClassSubjectProgress {
  name: string;
  subjectId: string | null;
  objectives: number;
  /** Students with every objective of this درس rated. */
  complete: number;
}

export interface ClassStudentSummary {
  studentProfileId: string;
  fullName: string;
  studentNumber: string | null;
  counts: RatingCounts;
  /** Objectives of the month not rated yet for this student. */
  missing: number;
}

export interface ClassReportOverview {
  classGroup: ReportClass;
  /** Months with objectives for this پایه, school-year order. */
  months: number[];
  /** The month shown (null = the پایه has no objectives). */
  month: number | null;
  monthName: string;
  subjects: ClassSubjectProgress[];
  students: ClassStudentSummary[];
  /** Total objectives of the month. */
  objectives: number;
  canWrite: boolean;
}

/**
 * One class in one month: its درس‌ها with how many students are fully rated, and each student's counts of the four
 * levels across the month. `month` omitted = the current Jalali month when the پایه has objectives for it, else the
 * nearest month that has some (`defaultReportMonth`). Read scope as `getRatingSheet`.
 */
export async function classReportOverview(tx: Tx, ctx: ReportCtx, input: { classGroupId: string; month?: number }, now = new Date()): Promise<ClassReportOverview> {
  const cg = await findReportClass(tx, input.classGroupId);
  if (!cg) throw notFound();
  if (!(await classAccess(tx, ctx, cg.id, "academic.objective_rating.read"))) throw notFound();
  const canWrite = await classAccess(tx, ctx, cg.id, "academic.objective_rating.write");
  const months = await availableMonths(tx, cg.gradeLevelId);
  const month = input.month ?? defaultReportMonth(months, tehranJalaliMonth(now));
  const objectives = month === null ? [] : await listObjectives(tx, cg.gradeLevelId, month);
  const roster = await listClassRoster(tx, cg.id, tehranToday(now));
  const ratings = await ratingsOf(
    tx,
    cg.academicYearId,
    roster.map((r) => r.studentProfileId),
    objectives.map((o) => o.id),
  );
  const groups = groupBySubject(objectives);
  const subjects = groups.map((g) => {
    const ids = g.objectives.map((o) => o.id);
    return {
      name: g.name,
      subjectId: g.subjectId,
      objectives: ids.length,
      complete: roster.filter((r) => isSheetComplete(ids, Object.fromEntries(ratings.get(r.studentProfileId) ?? []))).length,
    };
  });
  const students = roster.map((r) => {
    const mine = ratings.get(r.studentProfileId);
    const counts = mine ? tallyRatings([...mine.values()]) : emptyRatingCounts();
    return { studentProfileId: r.studentProfileId, fullName: r.fullName, studentNumber: r.studentNumber, counts, missing: objectives.length - (mine?.size ?? 0) };
  });
  return { classGroup: cg, months, month, monthName: month === null ? "" : jalaliMonthName(month), subjects, students, objectives: objectives.length, canWrite };
}

// ---------------------------------------------------------------------------------------------------------------
// one student's report card (the student's own page and the printable A4 card)
// ---------------------------------------------------------------------------------------------------------------

export interface ReportCardSubject {
  name: string;
  subjectId: string | null;
  objectives: Array<{ id: string; text: string; domain: ObjectiveDomain | null; rating: ObjectiveRating | null }>;
  counts: RatingCounts;
}

export interface StudentReportCard {
  studentProfileId: string;
  fullName: string;
  studentNumber: string | null;
  classGroup: ReportClass;
  months: number[];
  month: number | null;
  monthName: string;
  subjects: ReportCardSubject[];
  counts: RatingCounts;
}

function buildCard(cg: ReportClass, student: { studentProfileId: string; fullName: string; studentNumber: string | null }, months: number[], month: number | null, objectives: readonly ObjectiveRow[], mine: Map<string, ObjectiveRating> | undefined): StudentReportCard {
  const subjects = groupBySubject(objectives).map((g) => {
    const rows = g.objectives.map((o) => ({ id: o.id, text: o.text, domain: o.domain, rating: mine?.get(o.id) ?? null }));
    return { name: g.name, subjectId: g.subjectId, objectives: rows, counts: tallyRatings(rows.map((r) => r.rating)) };
  });
  return {
    studentProfileId: student.studentProfileId,
    fullName: student.fullName,
    studentNumber: student.studentNumber,
    classGroup: cg,
    months,
    month,
    monthName: month === null ? "" : jalaliMonthName(month),
    subjects,
    counts: tallyRatings(subjects.flatMap((s) => s.objectives.map((o) => o.rating))),
  };
}

/**
 * «کارنامهٴ من»: the signed-in student's own card for a month (null when they are not a student or have no class
 * whose پایه has objectives). The row filter is the boundary — the student's OWN profile, checked with
 * `can(..., student)` so a student role of somebody else never matches.
 */
export async function myReportCard(tx: Tx, ctx: ReportCtx, input: { month?: number }, now = new Date()): Promise<StudentReportCard | null> {
  const mine = await findStudentProfile(tx, ctx.personId);
  if (!mine) return null;
  if (!(await can(tx, ctx, "academic.objective_rating.read", { scopeType: "student", id: mine.id }))) return null;
  const cls = await findClassOfStudentProfile(tx, mine.id);
  if (!cls) return null;
  const cg = await findReportClass(tx, cls.classGroupId);
  if (!cg) return null;
  const months = await availableMonths(tx, cg.gradeLevelId);
  if (months.length === 0) return null;
  const month = input.month ?? defaultReportMonth(months, tehranJalaliMonth(now));
  const objectives = month === null ? [] : await listObjectives(tx, cg.gradeLevelId, month);
  const ratings = await ratingsOf(
    tx,
    cg.academicYearId,
    [mine.id],
    objectives.map((o) => o.id),
  );
  const number = await tx.execute<{ student_number: string | null }>(sql`select student_number from iam.student_profile where id = ${mine.id}::uuid`);
  return buildCard(cg, { studentProfileId: mine.id, fullName: mine.fullName, studentNumber: number.rows[0]?.student_number ?? null }, months, month, objectives, ratings.get(mine.id));
}

/**
 * The printable report cards of a class for one month — every student of the roster, or the one `studentProfileId`
 * (who must be in the roster). Read scope as `getRatingSheet`.
 */
export async function classReportCards(tx: Tx, ctx: ReportCtx, input: { classGroupId: string; month: number; studentProfileId?: string }, now = new Date()): Promise<{ classGroup: ReportClass; monthName: string; cards: StudentReportCard[] }> {
  const cg = await findReportClass(tx, input.classGroupId);
  if (!cg) throw notFound();
  if (!(await classAccess(tx, ctx, cg.id, "academic.objective_rating.read"))) throw notFound();
  const months = await availableMonths(tx, cg.gradeLevelId);
  const objectives = await listObjectives(tx, cg.gradeLevelId, input.month);
  let roster = await listClassRoster(tx, cg.id, tehranToday(now));
  if (input.studentProfileId) {
    roster = roster.filter((r) => r.studentProfileId === input.studentProfileId);
    if (roster.length === 0) throw notFound();
  }
  const ratings = await ratingsOf(
    tx,
    cg.academicYearId,
    roster.map((r) => r.studentProfileId),
    objectives.map((o) => o.id),
  );
  return {
    classGroup: cg,
    monthName: jalaliMonthName(input.month),
    cards: roster.map((r) => buildCard(cg, r, months, input.month, objectives, ratings.get(r.studentProfileId))),
  };
}
