// «مرخصی و خروج مجاز» (owner, 2026-10-20; src/lib/leave.ts, src/modules/academic/leave-dto.ts): the date-range rules of a
// guardian's request, the overlap rule between two live requests, what an approved leave and an authorized exit cover
// in a roll call, the DTO bounds and the catalog (permissions, notification types, titles). Everything that needs the
// database — the guardian-only reach, the scope of the managers, the roster pre-mark, the audit — is in
// tests/int/leave.test.ts.
import { describe, expect, it } from "vitest";
import { SYSTEM_ROLES, NOTIFICATION_TYPES, NON_MANAGER_PERMS } from "../../scripts/catalog";
import {
  COVERAGE_LABELS,
  EARLY_EXIT_CATEGORIES,
  LEAVE_CATEGORIES,
  LEAVE_MAX_DAYS,
  LEAVE_MESSAGES,
  cleanOptionalText,
  earlyExitCovers,
  leaveCovers,
  leaveDays,
  leaveLengthFa,
  leaveRequestedTitle,
  leaveSpanFa,
  leavesOverlap,
  normalizeClock,
  tehranClock,
  validateLeaveRange,
} from "@/lib/leave";
import { guardianNotificationTitle } from "@/modules/iam/guardian-policy";
import { CancelEarlyExitInput, CancelLeaveInput, DecideLeaveInput, RecordEarlyExitInput, RequestLeaveInput } from "@/modules/academic/leave-dto";
import { PERMISSIONS } from "@/modules/iam/permissions";

/** سه‌شنبه ۱۴۰۵/۰۶/۳۱, 12:05 Tehran — the instant the attendance tests pin. */
const NOW = new Date("2026-09-22T08:35:00Z");
const TODAY = "2026-09-22";
const CHILD = "0199a000-0001-7000-8000-0000000000c1";
const REQUEST = "0199a000-0001-7000-8000-0000000000c2";

const span = (fromDate: string, toDate: string, fromPeriod: number | null = null, toPeriod: number | null = null) => ({ fromDate, toDate, fromPeriod, toPeriod });

describe("validateLeaveRange", () => {
  it("accepts today, a later day, and a range of exactly 14 days", () => {
    expect(validateLeaveRange({ fromDate: TODAY, toDate: TODAY }, NOW)).toBeNull();
    expect(validateLeaveRange({ fromDate: "2026-09-25", toDate: "2026-09-26" }, NOW)).toBeNull();
    expect(validateLeaveRange({ fromDate: TODAY, toDate: "2026-10-05" }, NOW)).toBeNull(); // 14 days inclusive
  });

  it("refuses a start before today (Tehran), an end before the start, a malformed date and more than 14 days", () => {
    expect(validateLeaveRange({ fromDate: "2026-09-21", toDate: "2026-09-23" }, NOW)).toMatchObject({ field: "fromDate", message: LEAVE_MESSAGES.pastDate });
    expect(validateLeaveRange({ fromDate: "2026-09-24", toDate: "2026-09-23" }, NOW)).toMatchObject({ field: "toDate", message: LEAVE_MESSAGES.badRange });
    expect(validateLeaveRange({ fromDate: "2026-02-30", toDate: "2026-09-23" }, NOW)).toMatchObject({ field: "fromDate", message: LEAVE_MESSAGES.badDate });
    expect(validateLeaveRange({ fromDate: TODAY, toDate: "nope" }, NOW)).toMatchObject({ field: "toDate", message: LEAVE_MESSAGES.badDate });
    expect(validateLeaveRange({ fromDate: TODAY, toDate: "2026-10-06" }, NOW)).toMatchObject({ field: "toDate", message: LEAVE_MESSAGES.tooLong });
    expect(LEAVE_MAX_DAYS).toBe(14);
  });

  it("«today» is the Tehran date: just after 20:30 UTC it is already tomorrow", () => {
    const lateEvening = new Date("2026-09-22T21:00:00Z"); // 00:30 on 2026-09-23 in Tehran
    expect(validateLeaveRange({ fromDate: "2026-09-22", toDate: "2026-09-22" }, lateEvening)).toMatchObject({ field: "fromDate", message: LEAVE_MESSAGES.pastDate });
    expect(validateLeaveRange({ fromDate: "2026-09-23", toDate: "2026-09-23" }, lateEvening)).toBeNull();
  });

  it("a partial day: both periods or none, within 1..12, in order, for ONE day only", () => {
    expect(validateLeaveRange({ fromDate: TODAY, toDate: TODAY, fromPeriod: 2, toPeriod: 4 }, NOW)).toBeNull();
    expect(validateLeaveRange({ fromDate: TODAY, toDate: TODAY, fromPeriod: 3, toPeriod: 3 }, NOW)).toBeNull();
    expect(validateLeaveRange({ fromDate: TODAY, toDate: TODAY, fromPeriod: 2, toPeriod: null }, NOW)).toMatchObject({ field: "toPeriod", message: LEAVE_MESSAGES.periodsPair });
    expect(validateLeaveRange({ fromDate: TODAY, toDate: TODAY, fromPeriod: null, toPeriod: 2 }, NOW)).toMatchObject({ field: "fromPeriod", message: LEAVE_MESSAGES.periodsPair });
    expect(validateLeaveRange({ fromDate: TODAY, toDate: TODAY, fromPeriod: 4, toPeriod: 2 }, NOW)).toMatchObject({ field: "toPeriod", message: LEAVE_MESSAGES.periodsOrder });
    expect(validateLeaveRange({ fromDate: TODAY, toDate: TODAY, fromPeriod: 0, toPeriod: 2 }, NOW)).toMatchObject({ field: "fromPeriod", message: LEAVE_MESSAGES.periodUnknown });
    expect(validateLeaveRange({ fromDate: TODAY, toDate: TODAY, fromPeriod: 2, toPeriod: 13 }, NOW)).toMatchObject({ field: "toPeriod", message: LEAVE_MESSAGES.periodUnknown });
    expect(validateLeaveRange({ fromDate: TODAY, toDate: "2026-09-23", fromPeriod: 2, toPeriod: 3 }, NOW)).toMatchObject({ field: "fromPeriod", message: LEAVE_MESSAGES.periodsOneDay });
  });

  it("counts calendar days inclusively", () => {
    expect(leaveDays("2026-09-22", "2026-09-22")).toBe(1);
    expect(leaveDays("2026-09-22", "2026-10-05")).toBe(14);
    expect(leaveLengthFa("2026-09-22", "2026-09-22")).toBe("یک روز");
    expect(leaveLengthFa("2026-09-22", "2026-09-24")).toBe("۳ روز");
  });
});

describe("leavesOverlap", () => {
  it("separate date ranges never overlap; touching ranges do", () => {
    expect(leavesOverlap(span("2026-09-22", "2026-09-23"), span("2026-09-24", "2026-09-25"))).toBe(false);
    expect(leavesOverlap(span("2026-09-22", "2026-09-24"), span("2026-09-24", "2026-09-25"))).toBe(true);
    expect(leavesOverlap(span("2026-09-22", "2026-09-30"), span("2026-09-25", "2026-09-25"))).toBe(true);
  });

  it("two partial days of one date overlap only when their periods do", () => {
    expect(leavesOverlap(span(TODAY, TODAY, 1, 3), span(TODAY, TODAY, 4, 6))).toBe(false);
    expect(leavesOverlap(span(TODAY, TODAY, 1, 3), span(TODAY, TODAY, 3, 6))).toBe(true);
    expect(leavesOverlap(span(TODAY, TODAY, 2, 2), span(TODAY, TODAY, 1, 5))).toBe(true);
  });

  it("a whole-day leave overlaps any partial day of its dates", () => {
    expect(leavesOverlap(span(TODAY, TODAY), span(TODAY, TODAY, 5, 6))).toBe(true);
    expect(leavesOverlap(span(TODAY, "2026-09-24", null, null), span("2026-09-23", "2026-09-23", 1, 1))).toBe(true);
  });
});

describe("what an approved leave covers in a roll call", () => {
  it("a whole-day leave covers every roll call of its dates — the daily one too — and nothing outside them", () => {
    const l = span("2026-09-22", "2026-09-24");
    expect(leaveCovers(l, "2026-09-22", null)).toBe(true);
    expect(leaveCovers(l, "2026-09-23", 4)).toBe(true);
    expect(leaveCovers(l, "2026-09-24", 1)).toBe(true);
    expect(leaveCovers(l, "2026-09-21", 1)).toBe(false);
    expect(leaveCovers(l, "2026-09-25", null)).toBe(false);
  });

  it("a partial day covers exactly its periods and never the daily roll call", () => {
    const l = span(TODAY, TODAY, 2, 4);
    expect(leaveCovers(l, TODAY, 1)).toBe(false);
    expect(leaveCovers(l, TODAY, 2)).toBe(true);
    expect(leaveCovers(l, TODAY, 4)).toBe(true);
    expect(leaveCovers(l, TODAY, 5)).toBe(false);
    expect(leaveCovers(l, TODAY, null)).toBe(false);
  });
});

describe("what an authorized early exit covers", () => {
  it("every زنگ that starts at or after the exit; the one in progress is not covered", () => {
    expect(earlyExitCovers("10:30", "10:30")).toBe(true);
    expect(earlyExitCovers("10:30", "11:15")).toBe(true);
    expect(earlyExitCovers("10:30", "09:45")).toBe(false); // started before the exit
    expect(earlyExitCovers("10:31", "10:30")).toBe(false);
  });

  it("accepts the database's HH:MM:SS and one-digit hours; a malformed time covers nobody", () => {
    expect(earlyExitCovers("10:30:00", "10:30:00")).toBe(true);
    expect(earlyExitCovers("9:05", "09:30:00")).toBe(true);
    expect(earlyExitCovers("nope", "09:30")).toBe(false);
    expect(earlyExitCovers("10:30", "")).toBe(false);
  });

  it("clock helpers: HH:MM normalization and the Tehran wall clock", () => {
    expect(normalizeClock("9:05")).toBe("09:05");
    expect(normalizeClock(" 23:59:30 ")).toBe("23:59");
    expect(normalizeClock("24:00")).toBeNull();
    expect(normalizeClock("12:60")).toBeNull();
    expect(tehranClock(NOW)).toBe("12:05");
    expect(tehranClock(new Date("2026-09-22T21:00:00Z"))).toBe("00:30");
  });
});

describe("labels and titles", () => {
  it("a span reads as one Persian line", () => {
    expect(leaveSpanFa(span("2026-09-23", "2026-09-23"))).toContain("یک روز");
    expect(leaveSpanFa(span("2026-09-23", "2026-09-26"))).toContain("۴ روز");
    expect(leaveSpanFa(span(TODAY, TODAY, 2, 4))).toContain("زنگ ۲ تا ۴");
    expect(leaveSpanFa(span(TODAY, TODAY, 3, 3))).toContain("زنگ ۳");
    expect(COVERAGE_LABELS).toEqual({ leave: "مرخصی", early_exit: "خروج مجاز" });
  });

  it("bell titles carry the kind of event and the child's name only", () => {
    expect(leaveRequestedTitle("لیلا نیک‌خواه")).toBe("درخواست مرخصی: لیلا نیک‌خواه");
    expect(guardianNotificationTitle("leave_approved", "لیلا نیک‌خواه")).toBe("مرخصی تأیید شد: لیلا نیک‌خواه");
    expect(guardianNotificationTitle("leave_rejected", "لیلا نیک‌خواه")).toBe("مرخصی رد شد: لیلا نیک‌خواه");
    expect(guardianNotificationTitle("early_exit", "لیلا نیک‌خواه")).toBe("خروج مجاز: لیلا نیک‌خواه");
  });

  it("cleanOptionalText trims, nulls the empty and cuts to the bound", () => {
    expect(cleanOptionalText("  ", 10)).toBeNull();
    expect(cleanOptionalText(null, 10)).toBeNull();
    expect(cleanOptionalText(" سلام ", 10)).toBe("سلام");
    expect(cleanOptionalText("x".repeat(20), 10)).toHaveLength(10);
  });
});

describe("DTO bounds (strict Zod)", () => {
  const request = { child: CHILD, fromDate: TODAY, toDate: TODAY, category: "illness" };

  it("a request: the category is one of the five, the note at most 300, unknown keys are refused", () => {
    expect(RequestLeaveInput.safeParse(request).success).toBe(true);
    expect(RequestLeaveInput.safeParse({ ...request, note: "x".repeat(300) }).success).toBe(true);
    expect(RequestLeaveInput.safeParse({ ...request, note: "x".repeat(301) }).success).toBe(false);
    for (const c of LEAVE_CATEGORIES) expect(RequestLeaveInput.safeParse({ ...request, category: c }).success).toBe(true);
    expect(RequestLeaveInput.safeParse({ ...request, category: "vacation" }).success).toBe(false);
    // The requester, the school and the status come from the session / database — never from input.
    expect(RequestLeaveInput.safeParse({ ...request, status: "approved" }).success).toBe(false);
    expect(RequestLeaveInput.safeParse({ ...request, schoolId: CHILD }).success).toBe(false);
    expect(RequestLeaveInput.safeParse({ ...request, requestedByPersonId: CHILD }).success).toBe(false);
    expect(RequestLeaveInput.safeParse({ ...request, child: "not-a-uuid" }).success).toBe(false);
    expect(RequestLeaveInput.safeParse({ ...request, fromDate: "1405/07/01" }).success).toBe(false);
  });

  it("a request's periods come from selects: «» and «none» mean no partial day, numbers stay within 1..12", () => {
    expect(RequestLeaveInput.parse({ ...request, fromPeriod: "", toPeriod: "none" })).toMatchObject({ fromPeriod: null, toPeriod: null });
    expect(RequestLeaveInput.parse({ ...request, fromPeriod: "2", toPeriod: "4" })).toMatchObject({ fromPeriod: 2, toPeriod: 4 });
    expect(RequestLeaveInput.safeParse({ ...request, fromPeriod: 0, toPeriod: 2 }).success).toBe(false);
    expect(RequestLeaveInput.safeParse({ ...request, fromPeriod: 2, toPeriod: 13 }).success).toBe(false);
  });

  it("a decision is approved or rejected, with a note of at most 300", () => {
    expect(DecideLeaveInput.safeParse({ id: REQUEST, decision: "approved" }).success).toBe(true);
    expect(DecideLeaveInput.safeParse({ id: REQUEST, decision: "rejected", note: "x".repeat(300) }).success).toBe(true);
    expect(DecideLeaveInput.safeParse({ id: REQUEST, decision: "rejected", note: "x".repeat(301) }).success).toBe(false);
    expect(DecideLeaveInput.safeParse({ id: REQUEST, decision: "cancelled" }).success).toBe(false);
    expect(DecideLeaveInput.safeParse({ id: REQUEST, decision: "approved", decidedByPersonId: CHILD }).success).toBe(false);
    expect(CancelLeaveInput.safeParse({ id: REQUEST }).success).toBe(true);
    expect(CancelLeaveInput.safeParse({ id: REQUEST, status: "pending" }).success).toBe(false);
  });

  it("an early exit: one of the five reasons, a pickup name of at most 60, a note of at most 300", () => {
    const exit = { studentProfileId: CHILD, category: "illness" };
    expect(RecordEarlyExitInput.safeParse(exit).success).toBe(true);
    expect(RecordEarlyExitInput.safeParse({ ...exit, time: "10:30", pickedUpBy: "x".repeat(60), note: "x".repeat(300) }).success).toBe(true);
    expect(RecordEarlyExitInput.safeParse({ ...exit, pickedUpBy: "x".repeat(61) }).success).toBe(false);
    expect(RecordEarlyExitInput.safeParse({ ...exit, note: "x".repeat(301) }).success).toBe(false);
    for (const c of EARLY_EXIT_CATEGORIES) expect(RecordEarlyExitInput.safeParse({ ...exit, category: c }).success).toBe(true);
    expect(RecordEarlyExitInput.safeParse({ ...exit, category: "travel" }).success).toBe(false);
    expect(RecordEarlyExitInput.safeParse({ ...exit, date: TODAY }).success).toBe(false); // the date is today, never input
    expect(RecordEarlyExitInput.safeParse({ ...exit, schoolId: CHILD }).success).toBe(false);
    expect(CancelEarlyExitInput.safeParse({ id: REQUEST }).success).toBe(true);
  });
});

describe("the catalog", () => {
  const perms = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.permissions ?? [];

  it("the guardian role asks for a leave; no other role holds that permission", () => {
    expect(perms("guardian_full")).toContain("academic.leave.request");
    for (const r of SYSTEM_ROLES.filter((x) => x.code !== "guardian_full")) expect(r.permissions, r.code).not.toContain("academic.leave.request");
    expect(NON_MANAGER_PERMS).toContain("academic.leave.request");
  });

  it("only the school managers decide a leave and record an exit — org admin, principal, vice principal; not a teacher, student, counselor or guardian", () => {
    for (const code of ["org_admin", "school_principal", "vice_principal"]) {
      expect(perms(code), code).toContain("academic.leave.decide");
      expect(perms(code), code).toContain("academic.early_exit.write");
    }
    for (const code of ["teacher", "student", "counselor", "guardian_full"]) {
      expect(perms(code), code).not.toContain("academic.leave.decide");
      expect(perms(code), code).not.toContain("academic.early_exit.write");
    }
  });

  it("the three permissions and the three bell types exist in the catalogs", () => {
    const codes = PERMISSIONS.map((p) => p.code) as string[];
    for (const p of ["academic.leave.request", "academic.leave.decide", "academic.early_exit.write"]) expect(codes).toContain(p);
    expect(NOTIFICATION_TYPES.find((n) => n.code === "academic.leave_requested")).toMatchObject({ module: "academic" });
    expect(NOTIFICATION_TYPES.find((n) => n.code === "guardian.leave_decided")).toMatchObject({ module: "guardian" });
    expect(NOTIFICATION_TYPES.find((n) => n.code === "guardian.early_exit")).toMatchObject({ module: "guardian" });
  });
});
