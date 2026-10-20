// «تنظیمات» (migration 0026; src/modules/config): feature switches and settings per organization, overridden per school.
// Precedence school > organization > default, the scope rule of the writes (organization level = organization-scoped
// holders; a school = in scope and overridable keys only), validation, the audit rows, and RLS of both tables. Every
// write runs in a transaction that is rolled back, so no audit row outlives the file.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { type Tx, withTenant } from "@/db/client";
import { AppError } from "@/lib/errors";
import { flagEnabled, setFlag, setSetting, settingOf, settingsView } from "@/modules/config/service";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import * as f from "./fixtures";
import { PG, Rollback, asAppRw, inRolledBackTx } from "./helpers";

const ORG_CTX = "select set_config('app.current_org_id', $1, true)";
const ALL = PERMISSIONS.map((p) => p.code);
const base = { userId: "00000000-0000-7000-8000-000000000001", requestId: "int-config", ip: "127.0.0.1", userAgent: null, orgName: "مدرسه الف" };
const orgAdmin = { ...base, orgId: f.ORG_A, personId: f.PERSON_A2, assignments: [{ roleCode: "org_admin", roleId: "r1", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL } satisfies Assignment] };
const principal = { ...base, orgId: f.ORG_A, personId: f.PERSON_A1, assignments: [{ roleCode: "school_principal", roleId: "r2", scopeType: "school", scopeId: f.SCHOOL_A, permissions: ALL } satisfies Assignment] };
const teacher = { ...base, orgId: f.ORG_A, personId: f.PERSON_A1, assignments: [{ roleCode: "teacher", roleId: "r3", scopeType: "class_offering", scopeId: f.OFFERING_A1, permissions: ["workspace.work_item.read"] } satisfies Assignment] };

/** Runs `fn` in org A's transaction and rolls it back. */
async function inOrgA(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(
    withTenant({ orgId: f.ORG_A }, async (tx) => {
      await fn(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (AppError.is(err)) return err.code;
    throw err;
  }
}

describe("feature switches", () => {
  it("default < organization < school; «پیروی» removes a level; a school row of a non-overridable key is ignored", async () => {
    await inOrgA(async (tx) => {
      expect(await flagEnabled(tx, "messaging")).toBe(false);
      await setFlag(tx, orgAdmin, { key: "messaging", schoolId: null, value: "on" });
      expect(await flagEnabled(tx, "messaging")).toBe(true);
      expect(await flagEnabled(tx, "messaging", f.SCHOOL_A)).toBe(true);
      await setFlag(tx, principal, { key: "messaging", schoolId: f.SCHOOL_A, value: "off" });
      expect(await flagEnabled(tx, "messaging", f.SCHOOL_A)).toBe(false);
      expect(await flagEnabled(tx, "messaging")).toBe(true);
      await setFlag(tx, principal, { key: "messaging", schoolId: f.SCHOOL_A, value: "inherit" });
      expect(await flagEnabled(tx, "messaging", f.SCHOOL_A)).toBe(true);

      // request_center is organization-only: a school row (written around the service) changes nothing.
      await tx.execute(sql`insert into config.feature_flag (id, organization_id, school_id, key, enabled) values (app.uuid_generate_v7(), ${f.ORG_A}, ${f.SCHOOL_A}, 'request_center', true)`);
      expect(await flagEnabled(tx, "request_center", f.SCHOOL_A)).toBe(false);

      const trail = await tx.execute<{ action: string; before: { enabled: boolean | null }; after: { enabled: boolean | null; schoolId: string | null }; request_id: string }>(
        sql`select action, before, after, request_id from audit.audit_log where action = 'config.feature_flag.changed' order by at, id`,
      );
      expect(trail.rows.map((r) => [r.before.enabled, r.after.enabled, r.after.schoolId])).toEqual([
        [null, true, null],
        [null, false, f.SCHOOL_A],
        [false, null, f.SCHOOL_A],
      ]);
      expect(trail.rows.every((r) => r.request_id === "int-config")).toBe(true);
    });
  });

  it("the organization level needs the permission at the ORGANIZATION; a school must be in scope and the key overridable", async () => {
    await inOrgA(async (tx) => {
      expect(await codeOf(setFlag(tx, principal, { key: "messaging", schoolId: null, value: "on" }))).toBe("FORBIDDEN");
      expect(await codeOf(setFlag(tx, principal, { key: "request_center", schoolId: f.SCHOOL_A, value: "on" }))).toBe("FORBIDDEN");
      expect(await codeOf(setFlag(tx, principal, { key: "messaging", schoolId: f.SCHOOL_B, value: "on" }))).toBe("NOT_FOUND");
      expect(await codeOf(setFlag(tx, orgAdmin, { key: "messaging", schoolId: f.SCHOOL_B, value: "on" }))).toBe("NOT_FOUND"); // another tenant's school
      expect(await codeOf(setFlag(tx, teacher, { key: "messaging", schoolId: f.SCHOOL_A, value: "on" }))).toBe("FORBIDDEN");
      expect(await codeOf(setFlag(tx, orgAdmin, { key: "messaging", schoolId: f.SCHOOL_A, value: "on" }))).toBe("ok");
    });
  });
});

describe("settings", () => {
  it("validates against the registry (Persian digits accepted), resolves school > organization > default, audits before/after", async () => {
    await inOrgA(async (tx) => {
      expect(await settingOf(tx, "grades.appeal_window_days")).toBe(7);
      expect(await codeOf(setSetting(tx, orgAdmin, { key: "grades.appeal_window_days", schoolId: null, mode: "set", value: "45" }))).toBe("VALIDATION");
      expect(await codeOf(setSetting(tx, orgAdmin, { key: "grades.appeal_window_days", schoolId: null, mode: "set", value: "x" }))).toBe("VALIDATION");
      await setSetting(tx, orgAdmin, { key: "grades.appeal_window_days", schoolId: null, mode: "set", value: "۱۰" });
      expect(await settingOf(tx, "grades.appeal_window_days")).toBe(10);
      expect(await settingOf(tx, "grades.appeal_window_days", f.SCHOOL_A)).toBe(10);
      await setSetting(tx, principal, { key: "grades.appeal_window_days", schoolId: f.SCHOOL_A, mode: "set", value: "5" });
      expect(await settingOf(tx, "grades.appeal_window_days", f.SCHOOL_A)).toBe(5);
      await setSetting(tx, principal, { key: "notif.quiet_hours", schoolId: f.SCHOOL_A, mode: "set", start: "۲۱:۳۰", end: "06:00" });
      expect(await settingOf(tx, "notif.quiet_hours", f.SCHOOL_A)).toEqual({ start: "21:30", end: "06:00" });
      expect(await settingOf(tx, "notif.quiet_hours")).toEqual({ start: "22:00", end: "07:00" });
      expect(await codeOf(setSetting(tx, principal, { key: "notif.quiet_hours", schoolId: f.SCHOOL_A, mode: "set", start: "25:00", end: "06:00" }))).toBe("VALIDATION");
      await setSetting(tx, principal, { key: "grades.appeal_window_days", schoolId: f.SCHOOL_A, mode: "inherit" });
      expect(await settingOf(tx, "grades.appeal_window_days", f.SCHOOL_A)).toBe(10);

      const trail = await tx.execute<{ before: { value: unknown }; after: { key: string; value: unknown } }>(
        sql`select before, after from audit.audit_log where action = 'config.setting_value.changed' order by at, id`,
      );
      expect(trail.rows.map((r) => [r.after.key, r.before.value, r.after.value])).toEqual([
        ["grades.appeal_window_days", null, 10],
        ["grades.appeal_window_days", null, 5],
        ["notif.quiet_hours", null, { start: "21:30", end: "06:00" }],
        ["grades.appeal_window_days", 5, null],
      ]);
    });
  });

  it("a stored value that no longer fits the registry is skipped (the next level applies)", async () => {
    await inOrgA(async (tx) => {
      await tx.execute(sql`insert into config.setting_value (id, organization_id, school_id, key, value) values (app.uuid_generate_v7(), ${f.ORG_A}, null, 'reminders.deadline_lead_hours', '9999'::jsonb)`);
      expect(await settingOf(tx, "reminders.deadline_lead_hours")).toBe(24);
    });
  });
});

describe("the «تنظیمات» page view", () => {
  it("the organization admin sees the organization level and every key; a principal their school and the overridable keys only", async () => {
    await inOrgA(async (tx) => {
      const org = await settingsView(tx, orgAdmin, null);
      expect(org.schoolId).toBeNull();
      expect(org.levels.map((l) => l.schoolId)).toEqual([null, f.SCHOOL_A]);
      expect(org.flags.map((x) => x.key)).toContain("request_center");
      const mine = await settingsView(tx, principal, null);
      expect(mine.schoolId).toBe(f.SCHOOL_A);
      expect(mine.levels.map((l) => l.schoolId)).toEqual([f.SCHOOL_A]);
      expect(mine.flags.map((x) => x.key)).not.toContain("request_center");
      expect(mine.flags.find((x) => x.key === "messaging")).toMatchObject({ enabled: false, source: "default", own: null, inherited: false });
      expect(await codeOf(settingsView(tx, principal, f.SCHOOL_B))).toBe("NOT_FOUND");
    });
  });
});

describe("RLS of config.feature_flag / config.setting_value", () => {
  it("a tenant sees only its own rows and cannot write another's", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        await c.query(`insert into config.feature_flag (id, organization_id, key, enabled) values (app.uuid_generate_v7(), $1, 'messaging', true)`, [f.ORG_A]);
        await c.query(`insert into config.setting_value (id, organization_id, key, value) values (app.uuid_generate_v7(), $1, 'grades.appeal_window_days', '3')`, [f.ORG_A]);
        await c.query(ORG_CTX, [f.ORG_B]);
        expect((await c.query("select 1 from config.feature_flag")).rowCount).toBe(0);
        expect((await c.query("select 1 from config.setting_value")).rowCount).toBe(0);
        await c.query("savepoint s");
        await expect(c.query(`insert into config.feature_flag (id, organization_id, key, enabled) values (app.uuid_generate_v7(), $1, 'x', true)`, [f.ORG_A])).rejects.toMatchObject({
          code: PG.INSUFFICIENT_PRIVILEGE,
        });
        await c.query("rollback to savepoint s");
        // A school of another organization cannot be named either (composite FK).
        await expect(
          c.query(`insert into config.feature_flag (id, organization_id, school_id, key, enabled) values (app.uuid_generate_v7(), $1, $2, 'messaging', true)`, [f.ORG_B, f.SCHOOL_A]),
        ).rejects.toMatchObject({ code: PG.FOREIGN_KEY_VIOLATION });
      });
    });
  });
});
