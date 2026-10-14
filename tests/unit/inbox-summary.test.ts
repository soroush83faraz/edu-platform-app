// The shell's summary (badge, bell, Home strip, GET /api/inbox/summary): every signed-in person may ask for it, and
// each count is behind its OWN permission — a counselor (catalog «مشاور»: `notif.notification.read`, no `workspace.*`)
// gets the bell count and zero work counts; a teacher gets both; someone with neither gets zeros. The handler is
// called directly (defineQuery is replaced by a pass-through that records its options); the counts are mocked.
import { describe, expect, it, vi } from "vitest";
import type { Assignment } from "@/modules/iam/can";

const calls = vi.hoisted(() => ({ inbox: 0, notif: 0 }));
vi.mock("@/lib/actions", () => ({
  defineQuery: (opts: unknown, handler: (tx: unknown, input: unknown, ctx: unknown) => Promise<unknown>) =>
    Object.assign((ctx: unknown) => handler({}, undefined, ctx), { opts }),
}));
vi.mock("@/modules/iam/service", () => ({ getPermissionScope: vi.fn() }));
vi.mock("@/modules/notif", () => ({
  unreadNotificationCount: vi.fn(async () => {
    calls.notif++;
    return 3;
  }),
}));
vi.mock("@/modules/workspace/repo", () => ({
  inboxCounts: vi.fn(async () => {
    calls.inbox++;
    return { overdue: 1, dueToday: 2, unread: 4 };
  }),
}));
vi.mock("@/modules/workspace/service", () => ({ getWorkItemDetail: vi.fn() }));

const { inboxSummaryQuery } = await import("@/modules/workspace/queries");
const run = inboxSummaryQuery as unknown as ((ctx: { personId: string; assignments: Assignment[] }) => Promise<unknown>) & { opts: { permission: string } };

const hat = (roleCode: string, permissions: string[]): Assignment => ({ roleCode, roleId: `r-${roleCode}`, scopeType: "school", scopeId: "s", permissions }) as unknown as Assignment;
const COUNSELOR = hat("counselor", ["counseling.case.read", "counseling.note.write", "counseling.referral.create", "notif.notification.read", "academic.objective_rating.read"]);
const TEACHER = hat("teacher", ["workspace.work_item.read", "notif.notification.read"]);

describe("inboxSummaryQuery — each count behind its own permission", () => {
  it("is open to every signed-in person (the implicit iam.account.self)", () => {
    expect(run.opts.permission).toBe("iam.account.self");
  });

  it("a counselor without workspace.*: the bell count, zero work counts, the work counts never read", async () => {
    calls.inbox = 0;
    expect(await run({ personId: "p", assignments: [COUNSELOR] })).toEqual({ overdue: 0, dueToday: 0, unread: 0, unreadNotifications: 3 });
    expect(calls.inbox).toBe(0);
  });

  it("a teacher: both halves", async () => {
    expect(await run({ personId: "p", assignments: [TEACHER] })).toEqual({ overdue: 1, dueToday: 2, unread: 4, unreadNotifications: 3 });
  });

  it("neither permission: zeros, nothing read", async () => {
    calls.inbox = 0;
    calls.notif = 0;
    expect(await run({ personId: "p", assignments: [hat("x", ["academic.timetable.read"])] })).toEqual({ overdue: 0, dueToday: 0, unread: 0, unreadNotifications: 0 });
    expect(calls).toEqual({ inbox: 0, notif: 0 });
  });
});
