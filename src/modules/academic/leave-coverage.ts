// academic/leave-coverage — which students of a roll call are EXCUSED beforehand (owner, 2026-10-20; docs/attendance.md
// «مرخصی و خروج مجاز»): a student with an APPROVED leave that covers the date (and the زنگ, for a partial day), or with
// an active «خروج مجاز» that day for a زنگ starting at or after the exit. The roll call opens with them marked «موجه»
// and tagged (still editable), and their guardians' «غیبت» is not sent. A leaf of academic (tables + pure rules only) —
// attendance.ts calls it, the guardian and manager services do not — so there is no import cycle with iam.
//
// Only FACTS leave this module (a student is covered by a leave or by an exit): never a category, a note or a name —
// a teacher sees the «مرخصی» / «خروج مجاز» tag and nothing of why.
import { and, eq, inArray, lte, gte } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { earlyExitCovers, leaveCovers, type CoverageKind } from "@/lib/leave";
import { earlyExit, leaveRequest } from "./schema";

export type { CoverageKind };

/**
 * The covered students among `studentProfileIds` for the roll call `(date, periodNo)`. `periodStartsAt` is the
 * `HH:MM` start of that زنگ in the school's bell schedule (null for the daily roll call or an unknown زنگ: an early
 * exit then covers nobody). An approved leave wins over an exit when both cover the student (the leave is the
 * parent's earlier word).
 */
export async function coverageOf(
  tx: Tx,
  input: { studentProfileIds: readonly string[]; date: string; periodNo: number | null; periodStartsAt: string | null },
): Promise<Map<string, CoverageKind>> {
  const out = new Map<string, CoverageKind>();
  const ids = [...new Set(input.studentProfileIds)];
  if (ids.length === 0) return out;

  const leaves = await tx
    .select({
      studentProfileId: leaveRequest.studentProfileId,
      fromDate: leaveRequest.fromDate,
      toDate: leaveRequest.toDate,
      fromPeriod: leaveRequest.fromPeriod,
      toPeriod: leaveRequest.toPeriod,
    })
    .from(leaveRequest)
    .where(and(inArray(leaveRequest.studentProfileId, ids), eq(leaveRequest.status, "approved"), lte(leaveRequest.fromDate, input.date), gte(leaveRequest.toDate, input.date)));
  for (const l of leaves) {
    if (leaveCovers(l, input.date, input.periodNo)) out.set(l.studentProfileId, "leave");
  }

  if (input.periodNo !== null && input.periodStartsAt !== null) {
    const exits = await tx
      .select({ studentProfileId: earlyExit.studentProfileId, exitTime: earlyExit.exitTime })
      .from(earlyExit)
      .where(and(inArray(earlyExit.studentProfileId, ids), eq(earlyExit.date, input.date), eq(earlyExit.status, "active")));
    for (const e of exits) {
      if (!out.has(e.studentProfileId) && earlyExitCovers(e.exitTime, input.periodStartsAt)) out.set(e.studentProfileId, "early_exit");
    }
  }
  return out;
}
