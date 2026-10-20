// «مرکز درخواست‌ها» (owner 2026-10-20; src/modules/workspace/request-sla.ts): the response-time math — the 80 % mark,
// the three statuses, what a check does — the escalation chain (staff → معاون → مدیر مدرسه → مدیر سازمان, a level
// nobody holds skipped, nobody past the organization admin), the request kinds and their settings, the job kinds and
// schedules, and the Home tile that only shows while the center is on.
import { describe, expect, it } from "vitest";
import { homeTilesFor, type TileHats } from "@/lib/modules-registry";
import { FEATURE_FLAGS } from "@/modules/config/flags";
import { SETTINGS } from "@/modules/config/settings";
import { JOB_KINDS, kindProblems } from "@/modules/ops/kinds";
import { SCHEDULES } from "@/modules/ops/schedules";
import type { Permission } from "@/modules/iam/permissions";
import {
  REQUEST_KINDS,
  currentLevel,
  levelOf,
  nextLevel,
  nextPeriod,
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

  it("a new period starts at the escalation", () => {
    expect(nextPeriod(at(48), 48)).toEqual({ periodStartedAt: at(48), dueAt: at(96) });
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
    for (const k of ["notif.quiet_hours", "reminders.deadline_lead_hours", "requests.sla_hours.admin_request", "requests.sla_hours.parent_message"] as const) {
      expect("upcoming" in SETTINGS[k], k).toBe(false);
    }
    expect(SETTINGS["requests.sla_hours.leave_request"]).toMatchObject({ upcoming: true });
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
