// The unified work-item list (owner, mock class-page-v3, 2026-10-07) of «پنل من» and the subject page: ONE list, no
// tabs — open rows overdue → by deadline → no deadline, then «انجام‌شده‌ها» and the finished rows (latest first); a
// status tag at every row's end; the giver's «۹ از ۲۴ انجام داده‌اند» / «همه انجام دادند». Plus the subject page's
// day cells (`sessionWeekDays`), dated in the week of the next session.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/inbox" }));

const { compareDone, compareOpen, listStatusOf, orderWorkItems, progressText, showsProgress } = await import("@/modules/workspace/work-item-list");
const { WorkItemList, WorkItemStatusTag } = await import("@/modules/workspace/ui/WorkItemList");
const { DEFAULT_PERIODS, nextSessionOf, sessionWeekDays } = await import("@/lib/timetable");
const { formatJalaliDayOfMonth } = await import("@/lib/format");
type Row = import("@/modules/workspace/repo").InboxRow;

const DAY = 86_400_000;
const now = Date.now();

let seq = 0;
function row(over: Partial<Row> = {}): Row {
  seq++;
  return {
    id: `item-${String(seq).padStart(3, "0")}`,
    title: `تکلیف شماره ${seq}`,
    priority: "normal",
    dueAt: new Date(now + 3 * DAY),
    createdAt: new Date(now - 5 * DAY),
    typeCode: "task",
    typeName: "تکلیف",
    statusCode: "open",
    statusName: "باز",
    category: "todo",
    creatorId: "t-1",
    creatorName: "مریم رضایی",
    createdByMe: false,
    unread: false,
    isPinned: false,
    myAssigneeState: "pending",
    assigneesTotal: 1,
    assigneesDone: 0,
    commentsCount: 0,
    bucket: "week",
    offeringId: "off-math",
    subjectId: "sub-math",
    subjectName: "ریاضی",
    classGroupName: "۱۲/۳",
    ...over,
  };
}

describe("status of a row", () => {
  it("open → «در انتظار», open in the overdue bucket → «مهلت گذشته», done → «انجام‌شده», cancelled → «حذف‌شده»", () => {
    expect(listStatusOf({ category: "todo", bucket: "week" })).toBe("pending");
    expect(listStatusOf({ category: "doing", bucket: "today" })).toBe("pending");
    expect(listStatusOf({ category: "todo", bucket: "overdue" })).toBe("overdue");
    expect(listStatusOf({ category: "doing", bucket: "overdue" })).toBe("overdue");
    expect(listStatusOf({ category: "done", bucket: "today" })).toBe("done");
    expect(listStatusOf({ category: "cancelled", bucket: "none" })).toBe("cancelled");
  });

  it("the tag is a pill (text-xs) with the agreed colours and words", () => {
    const tag = (s: Parameters<typeof WorkItemStatusTag>[0]["status"]) => renderToStaticMarkup(createElement(WorkItemStatusTag, { status: s }));
    expect(tag("pending")).toContain("در انتظار");
    expect(tag("pending")).toMatch(/bg-primary-50 text-primary-700/);
    expect(tag("overdue")).toContain("مهلت گذشته");
    expect(tag("overdue")).toMatch(/bg-danger-soft text-danger/);
    expect(tag("done")).toContain("انجام‌شده");
    expect(tag("done")).toMatch(/bg-success-soft text-success/);
    for (const s of ["pending", "overdue", "done", "cancelled"] as const) expect(tag(s)).toMatch(/class="[^"]*\btext-xs\b/);
    // Green only says «completed».
    for (const s of ["pending", "overdue", "cancelled"] as const) expect(tag(s)).not.toMatch(/success/);
  });
});

describe("ordering", () => {
  it("overdue → by deadline → no deadline, then the finished rows latest first", () => {
    const later = row({ id: "later", dueAt: new Date(now + 9 * DAY), bucket: "later" });
    const none = row({ id: "none", dueAt: null, bucket: "none" });
    const late2 = row({ id: "late2", dueAt: new Date(now - 1 * DAY), bucket: "overdue" });
    const late5 = row({ id: "late5", dueAt: new Date(now - 5 * DAY), bucket: "overdue" });
    const soon = row({ id: "soon", dueAt: new Date(now + 1 * DAY), bucket: "week" });
    const doneOld = row({ id: "done-old", category: "done", dueAt: new Date(now - 9 * DAY), bucket: "today" });
    const doneNew = row({ id: "done-new", category: "done", dueAt: new Date(now - 1 * DAY), bucket: "today" });
    const doneNone = row({ id: "done-none", category: "done", dueAt: null, bucket: "none" });
    const gone = row({ id: "gone", category: "cancelled", dueAt: new Date(now - 3 * DAY), bucket: "today" });
    const { open, done } = orderWorkItems([later, doneOld, none, late2, doneNone, soon, gone, late5, doneNew]);
    expect(open.map((r) => r.id)).toEqual(["late5", "late2", "soon", "later", "none"]);
    expect(done.map((r) => r.id)).toEqual(["done-new", "gone", "done-old", "done-none"]);
  });

  it("an overdue row leads even against an earlier-dated open one, and ties fall back to the id", () => {
    const a = row({ id: "a", dueAt: new Date(now - 2 * DAY), bucket: "today" });
    const b = row({ id: "b", dueAt: new Date(now - 1 * DAY), bucket: "overdue" });
    expect(compareOpen(b, a)).toBeLessThan(0);
    const t = new Date(now + DAY);
    expect(compareOpen(row({ id: "x", dueAt: t }), row({ id: "y", dueAt: t }))).toBeLessThan(0);
    expect(compareDone(row({ id: "x", dueAt: null }), row({ id: "y", dueAt: new Date(now - 30 * DAY) }))).toBeGreaterThan(0);
  });
});

describe("progress on what I gave", () => {
  it("«۹ از ۲۴ انجام داده‌اند», and «همه انجام دادند» once everyone has", () => {
    expect(progressText(9, 24)).toBe("۹ از ۲۴ انجام داده‌اند");
    expect(progressText(0, 3)).toBe("۰ از ۳ انجام داده‌اند");
    expect(progressText(24, 24)).toBe("همه انجام دادند");
  });

  it("only on what I gave to others — not on what I received, not on my own personal note", () => {
    expect(showsProgress({ createdByMe: true, assigneesTotal: 24, myAssigneeState: null })).toBe(true);
    expect(showsProgress({ createdByMe: false, assigneesTotal: 24, myAssigneeState: "pending" })).toBe(false);
    expect(showsProgress({ createdByMe: true, assigneesTotal: 1, myAssigneeState: "pending" })).toBe(false);
    expect(showsProgress({ createdByMe: true, assigneesTotal: 0, myAssigneeState: null })).toBe(false);
  });
});

describe("WorkItemList", () => {
  const render = (props: Parameters<typeof WorkItemList>[0]) => renderToStaticMarkup(createElement(WorkItemList, props));

  it("one list: the open rows, the «انجام‌شده‌ها» divider, then the finished rows — no tabs", () => {
    const html = render({
      open: [row({ id: "o1", title: "اول" }), row({ id: "o2", title: "دوم", bucket: "overdue", dueAt: new Date(now - DAY) })],
      done: [row({ id: "d1", title: "سوم", category: "done", bucket: "today" })],
    });
    expect(html.match(/<ul /g)).toHaveLength(1);
    const at = (s: string) => html.indexOf(s);
    // The list orders what it is handed: the overdue row leads.
    expect(at('data-row-id="o2"')).toBeLessThan(at('data-row-id="o1"'));
    expect(at('data-row-id="o1"')).toBeLessThan(at("انجام‌شده‌ها"));
    expect(at("انجام‌شده‌ها")).toBeLessThan(at('data-row-id="d1"'));
    expect(html).toContain('data-status="pending"');
    expect(html).toContain('data-status="overdue"');
    expect(html).toContain('data-status="done"');
    expect(html).not.toMatch(/tab=/);
  });

  it("no divider without finished rows; the open-empty line when only finished ones exist", () => {
    expect(render({ open: [row()], done: [] })).not.toContain("انجام‌شده‌ها");
    const html = render({ open: [], done: [row({ category: "done", bucket: "today" })], openEmpty: "تکلیفی برای این درس در انتظار نیست" });
    expect(html.indexOf("تکلیفی برای این درس در انتظار نیست")).toBeLessThan(html.indexOf("انجام‌شده‌ها"));
  });

  it("a giver's row: «N از M انجام داده‌اند» over a sky bar; «همه انجام دادند» without a bar once all are done", () => {
    const html = render({ open: [row({ id: "g", createdByMe: true, myAssigneeState: null, assigneesTotal: 24, assigneesDone: 9 })], done: [] });
    expect(html).toContain("۹ از ۲۴ انجام داده‌اند");
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="9"/);
    expect(html).toMatch(/bg-sky/);
    const all = render({ open: [], done: [row({ id: "h", category: "done", bucket: "today", createdByMe: true, myAssigneeState: null, assigneesTotal: 24, assigneesDone: 24 })] });
    expect(all).toContain("همه انجام دادند");
    expect(all).not.toContain('role="progressbar"');
  });

  it("on the subject page: no mark, no درس in the meta, an end chevron; in «پنل من»: the مُهر درس and the درس name", () => {
    const subject = render({ open: [row({ subjectName: "شیمی" })], done: [], rowProps: { inSubject: true, mark: false, chevron: true } });
    expect(subject).not.toContain("شیمی");
    expect(subject).toContain("lucide-chevron-left");
    const inbox = render({ open: [row({ subjectName: "شیمی" })], done: [] });
    expect(inbox).toContain("شیمی");
    expect(inbox).toMatch(/rounded-stamp/);
  });
});

describe("subject page day cells", () => {
  // 2026-09-22 is a Tuesday (سه‌شنبه = 3) = ۳۱ شهریور ۱۴۰۵; 08:35 UTC = 12:05 Tehran.
  const TUE_1205 = new Date("2026-09-22T08:35:00Z");
  const slot = (weekday: number, periodNo: number) => {
    const p = DEFAULT_PERIODS.find((x) => x.periodNo === periodNo)!;
    return { weekday, periodNo, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt };
  };
  const slots = [slot(3, 5), slot(0, 1), slot(1, 2), slot(0, 3)];

  it("one cell per class day in weekday order, its sessions in time order, the next one marked", () => {
    const next = nextSessionOf(slots, DEFAULT_PERIODS, TUE_1205);
    const days = sessionWeekDays(slots, next, TUE_1205);
    expect(days.map((d) => d.weekday)).toEqual([0, 1, 3]);
    expect(days[0].sessions.map((s) => s.periodNo)).toEqual([1, 3]);
    expect(days.filter((d) => d.isNext).map((d) => d.weekday)).toEqual([3]);
    // This week: شنبه ۲۸ شهریور … سه‌شنبه ۳۱ شهریور.
    expect(days.map((d) => formatJalaliDayOfMonth(d.at))).toEqual(["۲۸", "۲۹", "۳۱"]);
  });

  it("when the next session is in next week, every cell is dated in that week", () => {
    const thu1500 = new Date("2026-09-24T11:30:00Z");
    const next = nextSessionOf(slots, DEFAULT_PERIODS, thu1500);
    expect(next).toMatchObject({ weekday: 0, daysAhead: 2 });
    const days = sessionWeekDays(slots, next, thu1500);
    // شنبه ۴ مهر, یک‌شنبه ۵ مهر, سه‌شنبه ۷ مهر.
    expect(days.map((d) => formatJalaliDayOfMonth(d.at))).toEqual(["۴", "۵", "۷"]);
    expect(days[0].isNext).toBe(true);
  });

  it("no slots → no cells", () => {
    expect(sessionWeekDays([], null, TUE_1205)).toEqual([]);
  });
});
