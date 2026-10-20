// «مرکز درخواست‌ها» (owner 2026-10-20; src/modules/workspace/request-sla.ts): the response-time math — the 80 % mark,
// the three statuses, what a check does, «در حال بررسی» stopping the clock (the owner's answer (c)) — the escalation
// chain (staff → معاون → مدیر مدرسه → مدیر سازمان, a level nobody holds skipped, nothing past the kind's top: a
// guardian's message or leave request stops at the principal, answer (a)), the request kinds and their settings, the
// job kinds and schedules, and the Home tile that only shows while the center is on.
import { describe, expect, it } from "vitest";
import { homeTilesFor, type TileHats } from "@/lib/modules-registry";
import { FEATURE_FLAGS } from "@/modules/config/flags";
import { SETTINGS } from "@/modules/config/settings";
import { JOB_KINDS, kindProblems } from "@/modules/ops/kinds";
import { SCHEDULES } from "@/modules/ops/schedules";
import type { Permission } from "@/modules/iam/permissions";
import {
  REQUEST_KINDS,
  activeLength,
  clockOnStatus,
  currentLevel,
  levelOf,
  nextLevel,
  nextPeriod,
  resumeShiftSeconds,
  slaAction,
  slaStatus,
  warnAt,
} from "@/modules/workspace/request-sla";
import { SYSTEM_ROLES } from "../../scripts/catalog";

const H = 3_600_000;
const start = new Date("2026-10-20T06:00:00Z");
const clock = (hours: number, warnedAt: Date | null = null) => ({ periodStartedAt: start, dueAt: new Date(start.getTime() + hours * H), warnedAt });
const at = (hours: number) => new Date(start.getTime() + hours * H);

describe("response time", () => {
  it("the 80 % mark of a period", () => {
    expect(warnAt(clock(72))).toEqual(at(57.6));
    expect(warnAt(clock(24))).toEqual(at(19.2));
  });

  it("در مهلت → نزدیک مهلت → گذشته", () => {
    expect(slaStatus(clock(48), at(1))).toBe("on_time");
    expect(slaStatus(clock(48), at(38.4))).toBe("near");
    expect(slaStatus(clock(48), at(47.9))).toBe("near");
    expect(slaStatus(clock(48), at(48))).toBe("overdue");
  });

  it("one reminder per period, then the escalation", () => {
    expect(slaAction(clock(48), at(10))).toBe("none");
    expect(slaAction(clock(48), at(40))).toBe("warn");
    expect(slaAction(clock(48, at(40)), at(41))).toBe("none");
    // A reminder of an EARLIER period does not count for this one.
    expect(slaAction(clock(48, new Date(start.getTime() - H)), at(40))).toBe("warn");
    expect(slaAction(clock(48, at(40)), at(48))).toBe("escalate");
    expect(slaAction(clock(48), at(60))).toBe("escalate");
  });

  it("a new period starts at the escalation — running, nothing paused", () => {
    expect(nextPeriod(at(48), 48)).toEqual({ periodStartedAt: at(48), dueAt: at(96), pausedSeconds: 0, pausedAt: null });
  });
});

describe("«در حال بررسی» stops the clock (owner, 2026-10-20)", () => {
  // A 48 h period that was paused for 10 h: the deadline moved from 48 h to 58 h after its start.
  const resumed = { periodStartedAt: start, dueAt: at(58), warnedAt: null, pausedSeconds: 10 * 3600 };

  it("the 80 % mark and the deadline count ACTIVE time only", () => {
    expect(activeLength(resumed)).toBe(48 * H);
    // 80 % of 48 h = 38.4 h of active time, + the 10 paused hours.
    expect(warnAt(resumed)).toEqual(at(48.4));
    expect(slaStatus(resumed, at(48))).toBe("on_time"); // without the pause it would be overdue
    expect(slaStatus(resumed, at(48.4))).toBe("near");
    expect(slaStatus(resumed, at(58))).toBe("overdue");
    expect(slaAction(resumed, at(48.5))).toBe("warn");
    expect(slaAction(resumed, at(57.9))).toBe("warn");
    expect(slaAction(resumed, at(58))).toBe("escalate");
  });

  it("while paused nothing happens, and the status reads as it stood when the clock stopped", () => {
    const paused = { ...clock(48), pausedAt: at(10) };
    expect(slaAction(paused, at(40))).toBe("none");
    expect(slaAction(paused, at(500))).toBe("none");
    expect(slaStatus(paused, at(500))).toBe("on_time");
    expect(slaStatus({ ...clock(48), pausedAt: at(40) }, at(500))).toBe("near");
    expect(slaStatus({ ...clock(48), pausedAt: at(50) }, at(500))).toBe("overdue");
  });

  it("back to «باز»: the whole seconds of the pause move the deadline (never negative)", () => {
    expect(resumeShiftSeconds(at(10), at(20))).toBe(10 * 3600);
    expect(resumeShiftSeconds(at(10), new Date(at(10).getTime() + 1999))).toBe(1);
    expect(resumeShiftSeconds(at(10), at(9))).toBe(0);
  });

  it("the status category decides: doing stops, todo runs, done / cancelled close", () => {
    expect(clockOnStatus("doing")).toBe("pause");
    expect(clockOnStatus("todo")).toBe("resume");
    expect(clockOnStatus("done")).toBe("close");
    expect(clockOnStatus("cancelled")).toBe("close");
    expect(clockOnStatus("other")).toBe("none");
  });
});

describe("the escalation chain", () => {
  const none = { vice_principal: [] as string[], principal: [] as string[], org_admin: [] as string[] };

  it("a person's level is their highest chain role", () => {
    expect(levelOf([])).toBe("staff");
    expect(levelOf(["vice_principal"])).toBe("vice_principal");
    expect(levelOf(["vice_principal", "school_principal"])).toBe("principal");
    expect(levelOf(["org_admin", "vice_principal"])).toBe("org_admin");
    expect(currentLevel([])).toBe(-1);
    expect(currentLevel(["staff", "vice_principal"])).toBe(1);
  });

  it("دبیر → معاون → مدیر مدرسه → مدیر سازمان", () => {
    const c = { vice_principal: ["v"], principal: ["p"], org_admin: ["o"] };
    expect(nextLevel(currentLevel(["staff"]), c, new Set(["t"]))).toEqual({ level: "vice_principal", personIds: ["v"] });
    expect(nextLevel(currentLevel(["staff", "vice_principal"]), c, new Set(["t", "v"]))).toEqual({ level: "principal", personIds: ["p"] });
    expect(nextLevel(currentLevel(["principal"]), c, new Set(["p"]))).toEqual({ level: "org_admin", personIds: ["o"] });
    expect(nextLevel(currentLevel(["org_admin"]), c, new Set(["o"]))).toBeNull();
  });

  it("a level nobody holds is skipped; nobody left → null", () => {
    expect(nextLevel(0, { ...none, principal: ["p"] }, new Set(["t"]))).toEqual({ level: "principal", personIds: ["p"] });
    expect(nextLevel(0, none, new Set(["t"]))).toBeNull();
    // Nobody live is left at all: the chain starts at the vice principals.
    expect(nextLevel(-1, { ...none, vice_principal: ["v1", "v2"] }, new Set(["gone"]))).toEqual({ level: "vice_principal", personIds: ["v1", "v2"] });
  });

  it("a guardian's message and a leave request never leave the school: past the principal there is nobody (owner, 2026-10-20)", () => {
    const c = { vice_principal: ["v"], principal: ["p"], org_admin: ["o"] };
    expect(REQUEST_KINDS.parent_message.topLevel).toBe("principal");
    expect(REQUEST_KINDS.leave_request.topLevel).toBe("principal");
    expect(REQUEST_KINDS.admin_request.topLevel).toBe("org_admin");
    // A counselor-addressed message (staff) still goes to the vice principal, then the principal — and stops.
    expect(nextLevel(currentLevel(["staff"]), c, new Set(["c"]), "principal")).toEqual({ level: "vice_principal", personIds: ["v"] });
    expect(nextLevel(currentLevel(["staff", "vice_principal"]), c, new Set(["c", "v"]), "principal")).toEqual({ level: "principal", personIds: ["p"] });
    expect(nextLevel(currentLevel(["principal"]), c, new Set(["p"]), "principal")).toBeNull();
    // A school with neither office: nothing to add rather than the organization admin.
    expect(nextLevel(0, { vice_principal: [], principal: [], org_admin: ["o"] }, new Set(["t"]), "principal")).toBeNull();
  });

  it("someone who is already an addressee (or the creator) is never added again", () => {
    expect(nextLevel(0, { ...none, vice_principal: ["v", "creator"] }, new Set(["t", "creator"]))).toEqual({ level: "vice_principal", personIds: ["v"] });
    expect(nextLevel(0, { ...none, vice_principal: ["v"], principal: ["p"] }, new Set(["t", "v"]))).toEqual({ level: "principal", personIds: ["p"] });
  });

  it("the chain roles are the catalog's system roles", () => {
    const codes = SYSTEM_ROLES.map((r) => r.code);
    for (const c of ["vice_principal", "school_principal", "org_admin"]) expect(codes).toContain(c);
  });
});

describe("kinds, settings, jobs, flags", () => {
  it("every request kind has its response-time setting (72 / 48 / 24 h)", () => {
    expect(SETTINGS[REQUEST_KINDS.admin_request.settingKey].default).toBe(72);
    expect(SETTINGS[REQUEST_KINDS.parent_message.settingKey].default).toBe(48);
    expect(SETTINGS[REQUEST_KINDS.leave_request.settingKey].default).toBe(24);
    expect(REQUEST_KINDS.leave_request.workItemType).toBeNull();
  });

  it("the job kinds are valid and the two scans are scheduled every 15 minutes", () => {
    for (const k of ["workspace.scan_deadlines", "workspace.remind_deadline", "workspace.notify_overdue", "workspace.check_request_slas"] as const) {
      expect(kindProblems(k, JOB_KINDS[k]), k).toEqual([]);
    }
    expect(SCHEDULES.find((s) => s.kind === "workspace.scan_deadlines")?.cron).toBe("7,22,37,52 * * * *");
    expect(SCHEDULES.find((s) => s.kind === "workspace.check_request_slas")?.cron).toBe("4,19,34,49 * * * *");
  });

  it("the two features are built (no «به‌زودی»), off by default, and the center is organization-level", () => {
    for (const k of ["deadline_reminders", "request_center"] as const) {
      expect("upcoming" in FEATURE_FLAGS[k], k).toBe(false);
      expect(FEATURE_FLAGS[k].default, k).toBe(false);
    }
    expect(FEATURE_FLAGS.request_center.schoolOverridable).toBe(false);
    for (const k of ["notif.quiet_hours", "reminders.deadline_lead_hours", "requests.sla_hours.admin_request", "requests.sla_hours.parent_message", "requests.sla_hours.leave_request"] as const) {
      expect("upcoming" in SETTINGS[k], k).toBe(false);
    }
    // The leave requests are wired (0030): their response time is no longer «به‌زودی».
    expect("upcoming" in SETTINGS["requests.sla_hours.leave_request"]).toBe(false);
  });

  it("the «مرکز درخواست‌ها» tile shows for an admin only while the flag is on", () => {
    const admin: TileHats = { isStudent: false, isTeacher: false, isAdmin: true, adminScope: "organization", singleSchoolId: null };
    const perms = SYSTEM_ROLES.find((r) => r.code === "org_admin")?.permissions ?? [];
    const has = (p: Permission) => perms.includes(p);
    const hrefs = (on: boolean) => homeTilesFor(admin, has, { variant: "hub", flags: (k) => on && k === "request_center" }).map((t) => t.href);
    expect(hrefs(false)).not.toContain("/admin/requests");
    expect(hrefs(true)).toContain("/admin/requests");
    expect(homeTilesFor(admin, has, { variant: "hub" }).map((t) => t.href)).not.toContain("/admin/requests");
  });
});
