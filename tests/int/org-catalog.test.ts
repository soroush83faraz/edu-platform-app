// The FIXED structure catalog (owner, 2026-09-27; src/modules/tenancy/fixed-catalog.ts): three مقطع‌ها, the twelve
// پایه‌ها and the years ۱۴۰۵-۱۴۰۶ / ۱۴۰۶-۱۴۰۷ for every school, written by `ensureOrgCatalogWith` (the deploy's
// catalog step, `pnpm seed`, every script that creates an organization) and by `ensureCatalogYears` when a school
// is created from «مدرسه‌ها». Existing rows are REUSED (by code, then by name/alias), nothing is deleted, a second
// run writes nothing, and the admin has no resource left to edit any of it.
// The catalog commits (it is its own transaction per organization), so afterAll re-creates the fixture database
// like seed.test does — later files assert the fixture's exact structure.
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import type { ResourceCtx } from "@/lib/admin/defineResource";
import { MutateInput, mutateResource } from "@/lib/admin/mutate";
import { gradeOptions } from "@/lib/admin/resources";
import type { Assignment } from "@/modules/iam/can";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { FIXED_GRADES, FIXED_LEVELS } from "@/modules/tenancy/fixed-catalog";
import { ensureOrgCatalogWith, seedOrgCatalogsWith } from "../../scripts/catalog";
import { runMigrations } from "../../scripts/migrate";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { Rollback } from "./helpers";

const ALL = PERMISSIONS.map((p) => p.code);
const orgAdmin: Assignment = { roleCode: "org_admin", roleId: "r-org", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL };
const ctx: ResourceCtx = { orgId: f.ORG_A, personId: f.PERSON_A2, userId: "00000000-0000-7000-8000-000000000000", requestId: "int-catalog", ip: "127.0.0.1", userAgent: null, assignments: [orgAdmin] };

async function owner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Rows of a tenant table of `orgId`, read as app_owner under that tenant (FORCE RLS). */
async function rowsOf<T>(c: Client, orgId: string, text: string, params: unknown[] = []): Promise<T[]> {
  await c.query("BEGIN");
  try {
    await c.query("select set_config('app.current_org_id', $1, true)", [orgId]);
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.query("ROLLBACK");
  }
}

describe("fixed structure catalog", () => {
  afterAll(async () => {
    await dropAppSchemas();
    await runMigrations({ test: true, connectionString: OWNER_URL });
    await seed();
  });

  it("reuses the fixture's rows (ELEM «ابتدایی» → «دبستان», G1 «اول», year ۱۴۰۵-۱۴۰۶), an alias-named مقطع, adds the rest, deletes nothing — and a second run writes nothing", async () => {
    await owner(async (c) => {
      // Organization B: a hand-typed «متوسطه اول» under another code, and a grade the catalog does not know.
      await c.query("BEGIN");
      await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_B]);
      const typed = (await c.query("insert into tenancy.education_level (id, organization_id, name, code, sequence) values (app.uuid_generate_v7(), $1, 'متوسطه اول', 'M1', 9) returning id", [f.ORG_B])).rows[0].id as string;
      await c.query("insert into tenancy.grade_level (id, organization_id, education_level_id, name, code, sequence) values (app.uuid_generate_v7(), $1, $2, 'پیش‌دانشگاهی', 'PRE', 13)", [f.ORG_B, f.LEVEL_B]);
      await c.query("COMMIT");

      const a = await ensureOrgCatalogWith(c, f.ORG_A);
      expect(a).toEqual({ organizations: 1, levelsCreated: 2, levelsUpdated: 1, gradesCreated: 11, gradesUpdated: 0, yearsCreated: 1, yearsMadeCurrent: 0, termsCreated: 2 });

      const levels = await rowsOf<{ id: string; code: string; name: string; sequence: number }>(c, f.ORG_A, "select id, code, name, sequence from tenancy.education_level order by sequence");
      expect(levels.map((l) => [l.code, l.name, l.sequence])).toEqual(FIXED_LEVELS.map((l) => [l.code, l.name, l.sequence]));
      expect(levels[0].id).toBe(f.LEVEL_A); // reused, renamed «ابتدایی» → «دبستان»
      const grades = await rowsOf<{ id: string; code: string; name: string; sequence: number; level: string }>(
        c,
        f.ORG_A,
        "select g.id, g.code, g.name, g.sequence, l.code as level from tenancy.grade_level g join tenancy.education_level l on l.id = g.education_level_id order by g.sequence",
      );
      expect(grades.map((g) => [g.code, g.name, g.sequence, g.level])).toEqual(FIXED_GRADES.map((g) => [g.code, g.name, g.sequence, g.levelCode]));
      expect(grades[0].id).toBe(f.GRADE_A);
      expect(grades.map((g) => g.name)).toEqual(["اول", "دوم", "سوم", "چهارم", "پنجم", "ششم", "هفتم", "هشتم", "نهم", "دهم", "یازدهم", "دوازدهم"]);

      const years = await rowsOf<{ id: string; name: string; is_current: boolean; starts_on: string; terms: number }>(
        c,
        f.ORG_A,
        "select y.id, y.name, y.is_current, to_char(y.starts_on, 'YYYY-MM-DD') as starts_on, (select count(*)::int from tenancy.term t where t.academic_year_id = y.id) as terms from tenancy.academic_year y where y.school_id = $1 order by y.starts_on",
        [f.SCHOOL_A],
      );
      // The fixture year is reused untouched (its one term stays one), ۱۴۰۶-۱۴۰۷ is added with two نوبت, not current.
      expect(years).toEqual([
        { id: f.YEAR_A, name: "۱۴۰۵-۱۴۰۶", is_current: true, starts_on: "2026-09-23", terms: 1 },
        { id: expect.any(String), name: "۱۴۰۶-۱۴۰۷", is_current: false, starts_on: "2027-09-23", terms: 2 },
      ]);
      const audited = await rowsOf<{ action: string; n: number }>(c, f.ORG_A, "select action, count(*)::int as n from audit.audit_log where request_id = 'seed-catalog' group by action order by action");
      expect(audited).toEqual([
        { action: "tenancy.academic_year.created", n: 1 },
        { action: "tenancy.education_level.created", n: 2 },
        { action: "tenancy.education_level.updated", n: 1 },
        { action: "tenancy.grade_level.created", n: 11 },
      ]);

      // Every organization at once: B's alias-named مقطع is reused (renamed, one row), its extra پایه survives.
      const all = await seedOrgCatalogsWith(c);
      expect(all.organizations).toBeGreaterThanOrEqual(2);
      const bLevels = await rowsOf<{ id: string; code: string; name: string }>(c, f.ORG_B, "select id, code, name from tenancy.education_level order by sequence");
      expect(bLevels.map((l) => l.name)).toEqual(["دبستان", "متوسطهٴ اول", "متوسطهٴ دوم"]);
      expect(bLevels[1]).toEqual({ id: typed, code: "M1", name: "متوسطهٴ اول" });
      const bGrades = await rowsOf<{ code: string }>(c, f.ORG_B, "select code from tenancy.grade_level order by sequence, code");
      expect(bGrades.map((g) => g.code)).toEqual([...FIXED_GRADES.map((g) => g.code), "PRE"]);

      // Idempotent: nothing left to write anywhere.
      const again = await seedOrgCatalogsWith(c);
      expect({ ...again, organizations: 0 }).toEqual({ organizations: 0, levelsCreated: 0, levelsUpdated: 0, gradesCreated: 0, gradesUpdated: 0, yearsCreated: 0, yearsMadeCurrent: 0, termsCreated: 0 });
    });
  });

  it("the پایه picker lists the grades in school order, each under its مقطع (<optgroup>)", async () => {
    const options = await withTenant({ orgId: f.ORG_A, personId: f.PERSON_A2 }, (tx: Tx) => gradeOptions(tx));
    expect(options.map((o) => o.label)).toEqual(FIXED_GRADES.map((g) => g.name));
    expect([...new Set(options.map((o) => o.group))]).toEqual(["دبستان", "متوسطهٴ اول", "متوسطهٴ دوم"]);
    expect(options.filter((o) => o.group === "متوسطهٴ اول").map((o) => o.label)).toEqual(["هفتم", "هشتم", "نهم"]);
  });

  it("a school created from «مدرسه‌ها» starts with both fixed years (۱۴۰۵-۱۴۰۶ current), two نوبت each", async () => {
    await expect(
      withTenant({ orgId: f.ORG_A, personId: f.PERSON_A2 }, async (tx) => {
        const { id } = await mutateResource(tx, ctx, { resource: "schools", op: "create", data: { name: "دبیرستان تازه", code: "NEW", genderPolicy: "girls", isDefault: false } });
        const years = await tx.execute<{ name: string; is_current: boolean; terms: number }>(
          sql`select y.name, y.is_current, (select count(*)::int from tenancy.term t where t.academic_year_id = y.id) as terms from tenancy.academic_year y where y.school_id = ${id} order by y.starts_on`,
        );
        expect(years.rows).toEqual([
          { name: "۱۴۰۵-۱۴۰۶", is_current: true, terms: 2 },
          { name: "۱۴۰۶-۱۴۰۷", is_current: false, terms: 2 },
        ]);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("years, terms, levels and grades have no admin resource: the mutation input refuses them", () => {
    for (const resource of ["years", "terms", "levels", "grades"]) {
      expect(MutateInput.safeParse({ resource, op: "create", data: {} }).success).toBe(false);
    }
    expect(MutateInput.safeParse({ resource: "subjects", op: "create", data: {} }).success).toBe(true);
  });
});
