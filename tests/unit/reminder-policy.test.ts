// «یادآوری مهلت تکالیف» (owner 2026-10-20): the quiet hours (src/modules/notif/quiet-hours.ts), WHEN a reminder and
// the giver's overdue notice are delivered (src/modules/workspace/reminder-policy.ts), and the deadline phrase of their
// titles (`formatDeadlineAtFa`). Asia/Tehran is UTC+03:30 all year: 22:00 Tehran = 18:30 UTC, 07:00 = 03:30 UTC.
import { describe, expect, it } from "vitest";
import { formatDeadlineAtFa } from "@/lib/format";
import { deliveryTime, inQuietHours, quietEnd, quietStart, tehranMinuteOfDay } from "@/modules/notif/quiet-hours";
import { OVERDUE_GRACE_MS, dueForScan, overdueNoticeAt, reminderAt } from "@/modules/workspace/reminder-policy";

const NIGHT = { start: "22:00", end: "07:00" };
const t = (iso: string) => new Date(iso);
const H = 3_600_000;

describe("quiet hours", () => {
  it("reads the Tehran wall clock", () => {
    expect(tehranMinuteOfDay(t("2026-10-20T18:30:00Z"))).toBe(22 * 60);
    expect(tehranMinuteOfDay(t("2026-10-20T20:29:00Z"))).toBe(23 * 60 + 59);
    expect(tehranMinuteOfDay(t("2026-10-20T20:30:00Z"))).toBe(0);
  });

  it("a window over midnight is [start, end)", () => {
    expect(inQuietHours(t("2026-10-20T18:29:00Z"), NIGHT)).toBe(false); // 21:59
    expect(inQuietHours(t("2026-10-20T18:30:00Z"), NIGHT)).toBe(true); // 22:00
    expect(inQuietHours(t("2026-10-20T22:00:00Z"), NIGHT)).toBe(true); // 01:30
    expect(inQuietHours(t("2026-10-21T03:29:00Z"), NIGHT)).toBe(true); // 06:59
    expect(inQuietHours(t("2026-10-21T03:30:00Z"), NIGHT)).toBe(false); // 07:00
  });

  it("a daytime window, and start = end is no window", () => {
    const noon = { start: "12:00", end: "13:00" };
    expect(inQuietHours(t("2026-10-20T08:30:00Z"), noon)).toBe(true);
    expect(inQuietHours(t("2026-10-20T09:30:00Z"), noon)).toBe(false);
    expect(inQuietHours(t("2026-10-20T19:00:00Z"), { start: "07:00", end: "07:00" })).toBe(false);
  });

  it("the window's end and start, on either side of midnight", () => {
    expect(quietEnd(t("2026-10-20T20:00:00Z"), NIGHT)).toEqual(t("2026-10-21T03:30:00Z")); // 23:30 → 07:00 next day
    expect(quietEnd(t("2026-10-21T01:00:00Z"), NIGHT)).toEqual(t("2026-10-21T03:30:00Z")); // 04:30 → 07:00 same day
    expect(quietStart(t("2026-10-20T20:00:00Z"), NIGHT)).toEqual(t("2026-10-20T18:30:00Z"));
    expect(quietStart(t("2026-10-21T01:00:00Z"), NIGHT)).toEqual(t("2026-10-20T18:30:00Z"));
    // Outside the window both return the instant itself.
    expect(quietEnd(t("2026-10-21T08:00:00Z"), NIGHT)).toEqual(t("2026-10-21T08:00:00Z"));
  });

  it("a nudge inside the window moves to its end — or just before it when the end is past the deadline", () => {
    const now = t("2026-10-20T12:00:00Z");
    expect(deliveryTime(t("2026-10-20T15:00:00Z"), null, NIGHT, now)).toEqual(t("2026-10-20T15:00:00Z"));
    expect(deliveryTime(t("2026-10-20T20:00:00Z"), t("2026-10-21T10:00:00Z"), NIGHT, now)).toEqual(t("2026-10-21T03:30:00Z"));
    expect(deliveryTime(t("2026-10-20T20:00:00Z"), null, NIGHT, now)).toEqual(t("2026-10-21T03:30:00Z"));
    // Deadline 05:30 Tehran: 07:00 is too late → 21:59 the evening before.
    expect(deliveryTime(t("2026-10-20T20:00:00Z"), t("2026-10-21T02:00:00Z"), NIGHT, now)).toEqual(t("2026-10-20T18:29:00Z"));
    // …and once that evening has passed, nothing is sent.
    expect(deliveryTime(t("2026-10-20T20:00:00Z"), t("2026-10-21T02:00:00Z"), NIGHT, t("2026-10-20T19:00:00Z"))).toBeNull();
  });
});

describe("the assignees' reminder", () => {
  const created = t("2026-10-01T06:00:00Z");
  const now = t("2026-10-19T06:00:00Z");

  it("lead hours before the deadline", () => {
    // Due 18:00 Tehran on the 22nd, 24 h lead → 18:00 on the 21st.
    expect(reminderAt({ dueAt: t("2026-10-22T14:30:00Z"), createdAt: created, leadHours: 24, quiet: NIGHT, now })).toEqual(t("2026-10-21T14:30:00Z"));
  });

  it("never in the quiet hours: to their end when that is still before the deadline", () => {
    // Due 09:00 Tehran, 10 h lead → 23:00 the night before → 07:00.
    expect(reminderAt({ dueAt: t("2026-10-22T05:30:00Z"), createdAt: created, leadHours: 10, quiet: NIGHT, now })).toEqual(t("2026-10-22T03:30:00Z"));
    // Due 06:00 Tehran, 2 h lead → 04:00 → 07:00 is too late → 21:59 the evening before.
    expect(reminderAt({ dueAt: t("2026-10-22T02:30:00Z"), createdAt: created, leadHours: 2, quiet: NIGHT, now })).toEqual(t("2026-10-21T18:29:00Z"));
  });

  it("an item given inside the lead window is reminded halfway, never on top of its «کار جدید» bell", () => {
    const given = t("2026-10-20T08:00:00Z");
    expect(reminderAt({ dueAt: t("2026-10-20T12:00:00Z"), createdAt: given, leadHours: 24, quiet: NIGHT, now: given })).toEqual(t("2026-10-20T10:00:00Z"));
  });

  it("a late scan reminds now; a passed deadline is not reminded", () => {
    const late = t("2026-10-21T16:00:00Z");
    expect(reminderAt({ dueAt: t("2026-10-22T14:30:00Z"), createdAt: created, leadHours: 24, quiet: NIGHT, now: late })).toEqual(late);
    expect(reminderAt({ dueAt: t("2026-10-21T14:30:00Z"), createdAt: created, leadHours: 24, quiet: NIGHT, now: late })).toBeNull();
  });

  it("a scan enqueues only what is due within its look-ahead", () => {
    expect(dueForScan(t("2026-10-19T06:20:00Z"), now)).toBe(true);
    expect(dueForScan(t("2026-10-19T07:00:00Z"), now)).toBe(false);
    expect(dueForScan(null, now)).toBe(false);
  });
});

describe("the giver's overdue notice", () => {
  it("at the deadline, out of the quiet hours, and not for a deadline more than a day old", () => {
    const now = t("2026-10-20T12:00:00Z");
    expect(overdueNoticeAt(t("2026-10-20T14:30:00Z"), NIGHT, now)).toEqual(t("2026-10-20T14:30:00Z"));
    expect(overdueNoticeAt(t("2026-10-20T19:30:00Z"), NIGHT, now)).toEqual(t("2026-10-21T03:30:00Z")); // 23:00 → 07:00
    expect(overdueNoticeAt(new Date(now.getTime() - OVERDUE_GRACE_MS - H), NIGHT, now)).toBeNull();
  });
});

describe("the deadline phrase of a reminder", () => {
  it("today / tomorrow / a weekday, with the hour or «پایان»", () => {
    const now = t("2026-10-20T06:00:00Z");
    expect(formatDeadlineAtFa(t("2026-10-20T14:30:00Z"), now)).toBe("امروز ساعت ۱۸");
    expect(formatDeadlineAtFa(t("2026-10-20T20:29:00Z"), now)).toBe("پایان امروز");
    expect(formatDeadlineAtFa(t("2026-10-21T07:00:00Z"), now)).toBe("فردا ساعت ۱۰:۳۰");
    expect(formatDeadlineAtFa(t("2026-10-23T14:30:00Z"), now)).toMatch(/^.+ ۱ آبان ساعت ۱۸$/);
  });
});
