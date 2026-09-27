// «پنل من» → «انجام‌نشده» as a board (owner, 2026-09-27): each deadline bucket is its own `surface-work` box with
// its name and count on top, the boxes sit in a two-column grid (2×2 for four buckets on a phone), an empty bucket
// renders nothing, and an odd last box keeps its single cell (no `col-span-2`). Rows inside are compact: the مُهر درس,
// the title clamped to two lines, one meta part on phones (the deadline, red when overdue), ≥ 44 px.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/inbox" }));

const { InboxBuckets, groupByBucket } = await import("@/modules/workspace/ui/InboxBuckets");
const { workItemWords } = await import("@/lib/work-item-words");
type Row = import("@/modules/workspace/repo").InboxRow;
type Bucket = Row["bucket"];

const DAY = 86_400_000;
const now = Date.now();
const DUE: Record<Bucket, Date | null> = {
  overdue: new Date(now - 2 * DAY),
  today: new Date(now + 60_000),
  week: new Date(now + 3 * DAY),
  later: new Date(now + 20 * DAY),
  none: null,
};

let seq = 0;
function row(bucket: Bucket, over: Partial<Row> = {}): Row {
  seq++;
  return {
    id: `item-${seq}`,
    title: `تکلیف شماره ${seq}`,
    priority: "normal",
    dueAt: DUE[bucket],
    createdAt: new Date(now - 5 * DAY),
    typeCode: "assignment",
    typeName: "تکلیف",
    statusCode: "todo",
    statusName: "انجام‌نشده",
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
    bucket,
    subjectId: "sub-math",
    subjectName: "ریاضی ۱",
    classGroupName: "۱۰/۱",
    ...over,
  } as Row;
}

const render = (rows: Row[]) =>
  renderToStaticMarkup(createElement(InboxBuckets, { rows, words: workItemWords("assignment"), createVoice: "assignment" as const }));
const boxesOf = (html: string) => [...html.matchAll(/<section [^>]*data-bucket="([a-z]+)"[^>]*class="([^"]*)"/g)].map((m) => ({ bucket: m[1], cls: m[2] }));

describe("«انجام‌نشده» bucket boxes", () => {
  it("each non-empty bucket is its own box, in bucket order, inside a two-column grid", () => {
    const html = render([row("week"), row("overdue"), row("today"), row("later"), row("today")]);
    expect(html).toMatch(/<div class="grid grid-cols-2 [^"]*" data-slot="bucket-grid">/);
    const boxes = boxesOf(html);
    expect(boxes.map((b) => b.bucket)).toEqual(["overdue", "today", "week", "later"]);
    for (const b of boxes) expect(b.cls.split(" ")).toContain("surface-work");
    // Every box has its own list of rows.
    expect(html.match(/<ul /g)).toHaveLength(4);
  });

  it("a box's header names the bucket with its count; only «سررسیده» is red, and never as a fill", () => {
    const html = render([row("overdue"), row("overdue"), row("today")]);
    const overdue = html.slice(html.indexOf('data-bucket="overdue"'), html.indexOf('data-bucket="today"'));
    expect(overdue).toContain("سررسیده");
    expect(overdue).toContain("۲");
    expect(overdue).toMatch(/<h3 class="[^"]*text-danger/);
    const today = html.slice(html.indexOf('data-bucket="today"'));
    expect(today).toContain("امروز");
    expect(today).not.toMatch(/<h3 class="[^"]*text-danger/);
    for (const b of boxesOf(html)) expect(b.cls).not.toMatch(/bg-danger/);
  });

  it("an empty bucket renders no box", () => {
    const html = render([row("today"), row("none")]);
    expect(boxesOf(html).map((b) => b.bucket)).toEqual(["today", "none"]);
    expect(html).not.toContain("سررسیده");
    expect(html).not.toContain("این هفته");
    expect(render([])).not.toContain("<section");
  });

  it("an odd count leaves the last box in its own cell (no col-span)", () => {
    const html = render([row("overdue"), row("today"), row("week")]);
    expect(boxesOf(html)).toHaveLength(3);
    expect(html).not.toMatch(/col-span/);
  });

  it("rows are compact links: ≥ 44 px, title clamped to two lines, the overdue deadline red", () => {
    const html = render([row("overdue", { id: "late" })]);
    const link = html.match(/<a [^>]*href="\/inbox\/late"[^>]*>/)?.[0] ?? "";
    expect(link).not.toBe("");
    expect(link.match(/class="([^"]*)"/)?.[1].split(" ")).toContain("min-h-11");
    expect(html).toMatch(/<p class="[^"]*line-clamp-2[^"]*text-row/);
    expect(html).toMatch(/<time [^>]*class="[^"]*text-danger/);
  });

  it("groupByBucket drops empty buckets and keeps the bucket order", () => {
    const groups = groupByBucket([row("later"), row("none"), row("overdue")]);
    expect(groups.map(([b]) => b)).toEqual(["overdue", "later", "none"]);
  });
});
