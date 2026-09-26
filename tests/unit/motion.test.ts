// Motion that answers the reader's own action (docs/decisions «حرکت در پاسخ به کار کاربر»): the finish hand-off
// between pages (src/lib/completion-moment), the once-a-day celebration rule, the leaving list's merge, and the
// first-render stillness of every counter — plus the stylesheet rule that each of these animations lives under
// `prefers-reduced-motion: no-preference`.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/inbox" }));

const moment = await import("@/lib/completion-moment");
const { mergeItems } = await import("@/components/motion/LeavingList");
const { CountBadge } = await import("@/components/CountBadge");
const { RollingNumber } = await import("@/components/motion/RollingNumber");
const { CheckBurst, DrawnCheck } = await import("@/components/motion/DrawnCheck");
const { SegmentedLinks } = await import("@/components/SegmentedLinks");

describe("completion moment", () => {
  it("the Tehran day turns at Tehran midnight, not UTC's", () => {
    expect(moment.tehranDayKey(new Date("2026-09-27T20:29:00Z"))).toBe("2026-09-27"); // 23:59 Tehran
    expect(moment.tehranDayKey(new Date("2026-09-27T20:31:00Z"))).toBe("2026-09-28"); // 00:01 Tehran
  });

  it("«امروز» is overdue or due by the end of today", () => {
    const now = new Date("2026-09-27T08:00:00Z");
    expect(moment.dueByToday(new Date("2026-09-20T08:00:00Z"), now)).toBe(true);
    expect(moment.dueByToday(new Date("2026-09-27T20:29:00Z"), now)).toBe(true);
    expect(moment.dueByToday(new Date("2026-09-27T20:31:00Z"), now)).toBe(false);
    expect(moment.dueByToday(null, now)).toBe(false);
  });

  it("a finish is handed to a stale list once; a refused one is forgotten", () => {
    moment.noteCompleted("a", null);
    moment.noteCompleted("b", null);
    moment.forgetCompleted("b");
    expect(moment.takeStaleCompleted(["x", "a", "b"])).toEqual(["a"]);
    expect(moment.takeStaleCompleted(["a"])).toEqual([]);
  });

  it("only a finish due by today waits for the celebration", () => {
    moment.clearPendingCelebration();
    const now = new Date("2026-09-27T08:00:00Z");
    moment.noteCompleted("later", new Date("2026-10-05T08:00:00Z"), now);
    expect(moment.pendingCelebration()).toBeNull();
    moment.noteCompleted("today", new Date("2026-09-27T10:00:00Z"), now);
    expect(moment.pendingCelebration()).toBe("2026-09-27");
    moment.clearPendingCelebration();
    expect(moment.pendingCelebration()).toBeNull();
  });

  it("celebrates a student's last overdue / today item, once a day", () => {
    const base = { student: true, overdue: 0, dueToday: 0, pendingDay: "2026-09-27", celebratedDay: null, today: "2026-09-27" };
    expect(moment.shouldCelebrate(base)).toBe(true);
    expect(moment.shouldCelebrate({ ...base, student: false })).toBe(false);
    expect(moment.shouldCelebrate({ ...base, overdue: 1 })).toBe(false);
    expect(moment.shouldCelebrate({ ...base, dueToday: 1 })).toBe(false);
    expect(moment.shouldCelebrate({ ...base, pendingDay: null })).toBe(false);
    expect(moment.shouldCelebrate({ ...base, pendingDay: "2026-09-26" })).toBe(false);
    expect(moment.shouldCelebrate({ ...base, celebratedDay: "2026-09-27" })).toBe(false);
    expect(moment.shouldCelebrate({ ...base, celebratedDay: "2026-09-26" })).toBe(true);
  });
});

describe("leaving list merge", () => {
  const item = (key: string) => ({ key, node: key, leaving: false });
  it("keeps a vanished row in place, marked leaving; new rows take their server order", () => {
    const merged = mergeItems([item("a"), item("b"), item("c")], [item("a"), item("c"), item("d")]);
    expect(merged.map((i) => `${i.key}${i.leaving ? "-" : ""}`)).toEqual(["a", "b-", "c", "d"]);
  });
  it("a row that arrives before a kept one lands before it", () => {
    const merged = mergeItems([item("b")], [item("a"), item("b")]);
    expect(merged.map((i) => i.key)).toEqual(["a", "b"]);
  });
});

describe("counters are still on first render", () => {
  it("RollingNumber and CountBadge render no roll class the first time", () => {
    const n = renderToStaticMarkup(createElement(RollingNumber, { value: 3 } as Parameters<typeof RollingNumber>[0], "۳"));
    expect(n).not.toMatch(/count-(up|down)/);
    const b = renderToStaticMarkup(createElement(CountBadge, { count: 3, label: "۳ مورد" }));
    expect(b).toContain("۳");
    expect(b).not.toMatch(/count-(up|down)|badge-pop/);
    expect(renderToStaticMarkup(createElement(CountBadge, { count: 0, label: "" }))).toBe("");
  });
});

describe("marks", () => {
  it("the drawn check is one path of length 1 that draws itself", () => {
    const html = renderToStaticMarkup(createElement(DrawnCheck));
    expect(html).toContain('pathLength="1"');
    expect(html).toContain("check-draw");
  });
  it("the burst: six strokes, five blue and one sky, around a blue disc — no glow", () => {
    const html = renderToStaticMarkup(createElement(CheckBurst));
    expect(html.match(/burst-ray/g)).toHaveLength(6);
    expect(html.match(/stroke-sky/g)).toHaveLength(1);
    expect(html.match(/stroke-primary-600/g)).toHaveLength(5);
    expect(html).not.toMatch(/filter|shadow|glow/);
  });
});

describe("segmented links", () => {
  const items = [
    { key: "todo", href: "/inbox", label: "انجام‌نشده", icon: null, count: { value: 4, text: "۴", label: "۴ تکلیف" } },
    { key: "done", href: "/inbox?tab=done", label: "انجام‌شده", icon: null },
  ];
  it("one sliding pill under the current segment; the current link is aria-current", () => {
    const html = renderToStaticMarkup(createElement(SegmentedLinks, { label: "وضعیت", items, current: "done" }));
    expect(html).toContain("translate:calc(-1 * (100% + 0.25rem)) 0");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(/<a[^>]*aria-current="page"[^>]*>/.exec(html)?.[0]).toContain('href="/inbox?tab=done"');
    expect(html).toContain("start-1"); // logical: the pill starts at the start (right) edge in RTL
  });
});

describe("globals.css", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  // Every animation of these keyframes must sit inside a `prefers-reduced-motion: no-preference` block.
  const FEEDBACK = ["count-in-up", "count-in-down", "check-draw", "strike-in", "burst-disc", "burst-ray", "pop-in"];
  it("feedback animations only run under no-preference", () => {
    const lines = css.split("\n");
    const stack: string[] = [];
    for (const line of lines) {
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      const m = /^\s*animation:\s*([\w-]+)/.exec(line);
      if (m && FEEDBACK.includes(m[1]!)) expect(stack.some((s) => s.includes("prefers-reduced-motion: no-preference")), line).toBe(true);
      for (let i = 0; i < opens; i++) stack.push(line);
      for (let i = 0; i < closes; i++) stack.pop();
    }
  });
});
