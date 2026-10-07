// A teacher's own colour per class (owner, 2026-10-06 — «هر کلاسِ دبیر یک رنگ جدا»; the rule is
// `teacherOfferingHues` in src/lib/subject-stamp.ts), read once per request (React `cache`) for the pages that do not
// already hold the teacher's offerings: the subject page, «حضور و غیاب», «پنل من». Pages that hold them (Home, «کلاس‌های
// من», the teaching week) compute the same map from the hats read — both draw from one SQL fragment, so they agree.
import { cache } from "react";
import { getRequestContext } from "@/lib/ctx";
import type { OfferingHues } from "@/lib/subject-stamp";
import { teacherHuesQuery } from "@/modules/iam/hats";

const NONE: OfferingHues = {};

/** The viewer's offering → hue map; empty (every درس keeps its own hue) for anyone without a teacher assignment. */
export const getTeacherHues = cache(async (): Promise<OfferingHues> => {
  const ctx = await getRequestContext();
  // Students and admins who do not teach: no read at all — the session already says they hold no teacher role.
  if (!ctx || !ctx.assignments.some((a) => a.roleCode === "teacher")) return NONE;
  const r = await teacherHuesQuery();
  return r.ok ? r.data : NONE;
});
