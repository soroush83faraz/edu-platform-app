// scripts/seed-pilot.ts must be deterministic and idempotent: a second run inserts nothing. Runs the real seedPilot
// (scaled down with PILOT_SCALE-equivalent `scale: 0.2`) against app_test as app_owner — the same code path as the
// CLI — then checks the tenant boundary: the ALK organization admin, under RLS as app_rw, sees nothing of FRZ.
// The rows it adds are removed again in afterAll by re-creating the fixture database (later files assert exact
// fixture counts).
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { withTenant } from "@/db/client";
import { runMigrations } from "../../scripts/migrate";
import { seedCatalog } from "../../scripts/seed";
import { ALLAMEH, FARZANEGAN, expectedCounts, pilotCounts, pilotId, pilotPhone, resetPilot, seedPilot } from "../../scripts/seed-pilot";
import { OWNER_URL } from "./env";
import { dropAppSchemas, seed } from "./global-setup";
import { asAppRw } from "./helpers";

const SCALE = 0.2;

describe("seed:pilot", () => {
  afterAll(async () => {
    await dropAppSchemas();
    await runMigrations({ test: true, connectionString: OWNER_URL });
    await seed();
  });

  it("running the pilot seed twice yields identical counts; the plan's numbers hold; tenants are isolated", async () => {
    const pool = new Pool({ connectionString: OWNER_URL, max: 1 });
    try {
      const db = drizzle({ client: pool, schema });
      await seedCatalog(db);
      const run1 = await seedPilot(db, { scale: SCALE, password: "Pilot-test-pass" });
      const first = await pilotCounts(db);
      const run2 = await seedPilot(db, { scale: SCALE, password: "Pilot-test-pass" });
      const second = await pilotCounts(db);

      expect(second).toEqual(first);
      expect(run2.summaries.map((s) => s.counts.createdAccounts)).toEqual([0, 0, 0]);

      const plan = expectedCounts(SCALE);
      expect(first.organizations).toBe(plan.organizations);
      expect(first.schools).toBe(plan.schools);
      expect(first.classGroups).toBe(plan.classGroups);
      expect(first.offerings).toBe(plan.offerings);
      expect(first.students).toBe(plan.students);
      expect(first.teacherAssignments).toBe(plan.offerings); // every offering has its main teacher
      expect(first.timetableSlots).toBe(plan.timetableSlots); // every offering has its 2–4 sessions on the grid
      expect(first.staff).toBe(plan.teachers + 3 * 3); // + admin, principal, vice per school
      expect(first.accounts).toBe(first.students + first.staff);
      expect(first.workItems).toBe(plan.workItems);
      expect(first.comments).toBeGreaterThan(0);
      expect(first.notifications).toBeGreaterThan(first.students);
      // Every teacher of the plan got 4–6 offerings and the first run created every account.
      for (const s of run1.summaries) for (const t of s.teachers) expect(t.offerings.length).toBeGreaterThanOrEqual(4);
      for (const s of run1.summaries) for (const t of s.teachers) expect(t.offerings.length).toBeLessThanOrEqual(6);
      expect(run1.summaries.reduce((n, s) => n + s.counts.createdAccounts, 0)).toBe(first.accounts);

      // The shared password is applied without a forced change; the ALK admin logs in by phone.
      const admin = await pool.query<{ must_change_password: boolean; n: string }>(
        "select must_change_password, (select count(*) from iam.auth_identity ai where ai.user_account_id = ua.id and ai.initial_password_enc is not null) as n from iam.user_account ua where login_identifier = $1",
        [pilotPhone(ALLAMEH.phoneBlock, 1)],
      );
      expect(admin.rows).toEqual([{ must_change_password: false, n: "0" }]);

      // --reset removes exactly the three pilot organizations (tenant rows, organizations, orphaned global accounts);
      // the fixture organizations A/B stay; a fresh seed afterwards rebuilds identical counts.
      const before = await pool.query<{ n: string }>("select count(*) as n from tenancy.organization");
      const reset = await resetPilot(db);
      expect(reset.organizations).toBe(3);
      expect(reset.deleted["tenancy.organization"]).toBe(3);
      expect(reset.deleted["iam.user_account"]).toBe(first.accounts);
      expect(await pilotCounts(db)).toMatchObject({ organizations: 0, students: 0, workItems: 0, notifications: 0 });
      const after = await pool.query<{ n: string }>("select count(*) as n from tenancy.organization");
      expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n) - 3);
      const gone = await pool.query<{ n: string }>("select count(*) as n from iam.user_account where login_identifier like '+98935%'");
      expect(gone.rows[0].n).toBe("0");
      expect(await resetPilot(db)).toEqual({ organizations: 0, deleted: {} });
      const run3 = await seedPilot(db, { scale: SCALE, password: "Pilot-test-pass" });
      expect(run3.summaries.reduce((n, s) => n + s.counts.createdAccounts, 0)).toBe(first.accounts);
      expect(await pilotCounts(db)).toEqual(first);
    } finally {
      await pool.end();
    }

    // RLS: as app_rw under the ALK tenant, FRZ's admin, school and students are invisible; the ALK rows are there.
    const alkOrg = pilotId(`org:${ALLAMEH.key}`);
    const frzOrg = pilotId(`org:${FARZANEGAN.key}`);
    const seen = await withTenant({ orgId: alkOrg }, async (tx) => {
      const persons = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from iam.person where organization_id = '${frzOrg}'`));
      const frzRef = await tx.execute<{ n: number }>(sql.raw("select count(*)::int as n from iam.person where external_ref like 'pilot:frz:%'"));
      const frzSchool = await tx.execute<{ n: number }>(sql.raw("select count(*)::int as n from tenancy.school where code = 'FRZ'"));
      const frzItems = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from workspace.work_item where organization_id = '${frzOrg}'`));
      const alkStudents = await tx.execute<{ n: number }>(sql.raw("select count(*)::int as n from iam.student_profile"));
      return { frzPersons: persons.rows[0].n, frzRef: frzRef.rows[0].n, frzSchool: frzSchool.rows[0].n, frzItems: frzItems.rows[0].n, alkStudents: alkStudents.rows[0].n };
    });
    expect(seen).toEqual({ frzPersons: 0, frzRef: 0, frzSchool: 0, frzItems: 0, alkStudents: ALLAMEH.classes.length * Math.max(2, Math.round(25 * SCALE)) });

    // And the FRZ admin's account is a global row app_rw can see, but its membership is not visible under ALK.
    const membership = await asAppRw((c) =>
      c.query<{ n: string }>("select count(*) as n from iam.user_account where login_identifier = $1", [pilotPhone(FARZANEGAN.phoneBlock, 1)]),
    );
    expect(membership.rows[0].n).toBe("1");
    const frzMembershipUnderAlk = await withTenant({ orgId: alkOrg }, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql.raw(`select count(*)::int as n from iam.organization_membership m join iam.user_account ua on ua.id = m.user_account_id where ua.login_identifier = '${pilotPhone(FARZANEGAN.phoneBlock, 1)}'`),
      );
      return r.rows[0].n;
    });
    expect(frzMembershipUnderAlk).toBe(0);
  }, 300_000);
});
