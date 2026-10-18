// The guardian's own reads (owner, 2026-10-18): Home's children and the four child pages. Each page's query names
// the permission of what it shows (held at ANY scope — the derived «ولی» assignment is scoped to a child), and the
// service checks it again at THAT child's student scope together with the live link (`requireChild` — NOT_FOUND).
// `child` is the page's `?child=` — a choice among the caller's own children, never trusted.
import { z } from "zod";
import { defineQuery } from "@/lib/actions";
import { childAttendance, childReportCard, childTimetable, listChildWorkItems, listMyChildren, requireChild } from "./guardian-views";

const child = z.uuid().optional();
const ChildInput = z.object({ child }).strict();
const ChildMonthInput = z.object({ child, month: z.number().int().min(1).max(12).optional() }).strict();

export type { ChildContext, GuardianChild } from "./guardian-views";

/** Home's cards: the caller's live children ([] for everyone else — every member may ask, `iam.account.self`). */
export const myChildrenQuery = defineQuery({ permission: "iam.account.self" }, async (tx, _input, ctx) => listMyChildren(tx, ctx));

/** «تکالیف فرزند»: the تکالیف given to the child (read-only rows of the unified list). */
export const childWorkQuery = defineQuery({ schema: ChildInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) => {
  const c = await requireChild(tx, ctx, input.child, "workspace.work_item.read");
  return { ...c, rows: await listChildWorkItems(tx, c.child) };
});

/** «حضور و غیاب» of the child: the last 30 days' counts and marks. */
export const childAttendanceQuery = defineQuery({ schema: ChildInput, permission: "academic.attendance.read", scope: "any" }, async (tx, input, ctx) => {
  const c = await requireChild(tx, ctx, input.child, "academic.attendance.read");
  return { ...c, summary: await childAttendance(tx, ctx, c.child) };
});

/** «کارنامه» of a primary child for a month (`card` null: the child's class has no report card). */
export const childReportCardQuery = defineQuery({ schema: ChildMonthInput, permission: "academic.objective_rating.read", scope: "any" }, async (tx, input, ctx) => {
  const c = await requireChild(tx, ctx, input.child, "academic.objective_rating.read");
  return { ...c, card: await childReportCard(tx, c.child, input.month) };
});

/** «برنامهٴ کلاسی» of the child: their class week. */
export const childTimetableQuery = defineQuery({ schema: ChildInput, permission: "academic.timetable.read", scope: "any" }, async (tx, input, ctx) => {
  const c = await requireChild(tx, ctx, input.child, "academic.timetable.read");
  return { ...c, timetable: await childTimetable(tx, c.child) };
});
