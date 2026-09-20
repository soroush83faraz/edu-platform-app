// vitest globalSetup for the `int` project (runs once, in the main process):
//   1. drop every app-owned schema in app_test (reset-equivalent that needs no superuser),
//   2. apply all migrations with the real migrator (scripts/migrate.ts) as app_owner,
//   3. insert fixtures for organizations A and B as app_owner.
// app_owner has NO BYPASSRLS and the tables are FORCE RLS, so even fixtures must set the org context.
import { Client } from "pg";
import { OWNER_URL } from "./env";
import { runMigrations } from "../../scripts/migrate";
import * as f from "./fixtures";

const APP_SCHEMAS = ["drizzle", "app", "tenancy", "iam", "academic", "workspace", "notif", "files", "audit", "config", "integ"];

export default async function setup(): Promise<void> {
  await dropAppSchemas();
  const { applied, total } = await runMigrations({ test: true, connectionString: OWNER_URL });
  if (applied !== total) throw new Error(`expected a fresh database to apply all ${total} migrations, applied ${applied}`);
  await seed();
}

/** Reset-equivalent without superuser: app_owner drops every schema it owns (extensions live in public). */
export async function dropAppSchemas(): Promise<void> {
  const owner = new Client({ connectionString: OWNER_URL });
  await owner.connect();
  try {
    await owner.query(`DROP SCHEMA IF EXISTS ${APP_SCHEMAS.map((s) => `"${s}"`).join(", ")} CASCADE`);
  } finally {
    await owner.end();
  }
}

/** Fixtures for organizations A and B (ids in ./fixtures). Requires a migrated, empty database. */
export async function seed(): Promise<void> {
  const c = new Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    // Global table: no RLS.
    await c.query(
      `INSERT INTO tenancy.organization (id, name, slug) VALUES ($1, 'مدرسه الف', 'school-a'), ($2, 'مدرسه ب', 'school-b')`,
      [f.ORG_A, f.ORG_B],
    );
    // System role template (organization_id IS NULL) — allowed for app_owner by the `system_templates` policy.
    await c.query(
      `INSERT INTO iam.role (id, organization_id, code, name, is_system, allowed_scope_types)
       VALUES ($1, NULL, 'teacher', 'معلم', true, ARRAY['class_offering','class_group'])`,
      [f.ROLE_TEMPLATE],
    );
    await c.query("COMMIT");

    await seedOrg(c, {
      org: f.ORG_A,
      school: f.SCHOOL_A,
      branch: f.BRANCH_A,
      year: f.YEAR_A,
      level: f.LEVEL_A,
      grade: f.GRADE_A,
      role: f.ROLE_A,
      persons: [
        [f.PERSON_A1, "علی", "رضایی"],
        [f.PERSON_A2, "زهرا", "کریمی"],
      ],
    });
    await seedOrg(c, {
      org: f.ORG_B,
      school: f.SCHOOL_B,
      branch: f.BRANCH_B,
      year: f.YEAR_B,
      level: f.LEVEL_B,
      grade: f.GRADE_B,
      role: f.ROLE_B,
      persons: [[f.PERSON_B1, "مریم", "احمدی"]],
    });
  } finally {
    await c.end();
  }
}

interface OrgFixture {
  org: string;
  school: string;
  branch: string;
  year: string;
  level: string;
  grade: string;
  role: string;
  persons: [id: string, firstName: string, lastName: string][];
}

async function seedOrg(c: Client, o: OrgFixture): Promise<void> {
  await c.query("BEGIN");
  try {
    await c.query("SELECT set_config('app.current_org_id', $1, true)", [o.org]);
    await c.query(`INSERT INTO tenancy.school (id, organization_id, name, code, is_default) VALUES ($1, $2, 'دبستان', 'S1', true)`, [
      o.school,
      o.org,
    ]);
    await c.query(`INSERT INTO tenancy.branch (id, organization_id, school_id, name, is_default) VALUES ($1, $2, $3, 'مرکزی', true)`, [
      o.branch,
      o.org,
      o.school,
    ]);
    await c.query(
      `INSERT INTO tenancy.academic_year (id, organization_id, school_id, name, starts_on, ends_on, is_current)
       VALUES ($1, $2, $3, '۱۴۰۵-۱۴۰۶', '2026-09-23', '2027-06-21', true)`,
      [o.year, o.org, o.school],
    );
    await c.query(`INSERT INTO tenancy.education_level (id, organization_id, name, code, sequence) VALUES ($1, $2, 'ابتدایی', 'ELEM', 1)`, [
      o.level,
      o.org,
    ]);
    await c.query(
      `INSERT INTO tenancy.grade_level (id, organization_id, education_level_id, name, code, sequence) VALUES ($1, $2, $3, 'اول', 'G1', 1)`,
      [o.grade, o.org, o.level],
    );
    await c.query(
      `INSERT INTO iam.role (id, organization_id, code, name, allowed_scope_types) VALUES ($1, $2, 'principal', 'مدیر', ARRAY['school'])`,
      [o.role, o.org],
    );
    for (const [id, firstName, lastName] of o.persons) {
      await c.query(`INSERT INTO iam.person (id, organization_id, first_name, last_name) VALUES ($1, $2, $3, $4)`, [
        id,
        o.org,
        firstName,
        lastName,
      ]);
    }
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  }
}
