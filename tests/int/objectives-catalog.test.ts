// «کارنامهٴ توصیفی» — the catalog step that installs the primary learning objectives (scripts/objectives-catalog.ts,
// migration 0017): every objective of the JSON for each پایه the organisation has (the fixture's ORG_A has only G1),
// a second run writes nothing, a corrected wording updates the row in place (its ratings stay), a dropped line is
// ARCHIVED not deleted, the organisation's matching درس row is linked, and the runtime role may only READ the table.
// The step commits (one transaction per organisation), so afterAll re-creates the fixture database like
// org-catalog.test does.
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PRIMARY_OBJECTIVES, ensureOrgObjectivesWith, seedOrgObjectivesWith } from "../../scripts/objectives-catalog";
import { runMigrations } from "../../scripts/migrate";
import type { PrimaryObjectivesFile } from "@/modules/academic/primary-objectives";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { PG, asAppRw, inRolledBackTx, pgCode } from "./helpers";

async function owner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function rowsOf<T>(c: Client, orgId: string, text: string, params: unknown[] = []): Promise<T[]> {
  await c.query("BEGIN");
  try {
    await c.query("select set_config('app.current_org_id', $1, true)", [orgId]);
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.query("ROLLBACK");
  }
}

const G1_TOTAL = PRIMARY_OBJECTIVES.grades[0].months.reduce((n, m) => n + m.subjects.reduce((k, s) => k + s.objectives.length, 0), 0);

/** A copy of the JSON with the first مهر قرآن objective of پایهٔ اول reworded and the last one dropped. */
function edited(): PrimaryObjectivesFile {
  const copy = structuredClone(PRIMARY_OBJECTIVES);
  const quran = copy.grades[0].months[0].subjects.find((s) => s.name === "قرآن")!;
  quran.objectives[0] = { ...quran.objectives[0], text: `${quran.objectives[0].text} (ویرایش‌شده)` };
  quran.objectives.pop();
  return copy;
}

describe("primary learning objectives catalog", () => {
  afterAll(async () => {
    await dropAppSchemas();
    await runMigrations({ test: true, connectionString: OWNER_URL });
    await seed();
  });

  it("installs پایهٔ اول for the fixture organisation, links its matching درس, and a second run writes nothing", async () => {
    await owner(async (c) => {
      // A «ریاضیات» درس row in ORG_A: the alias links every ریاضی objective to it. The fixture already has a
      // «ریاضی» (code MATH) and the link takes the first match by code, so this row's code must sort before it.
      await c.query("BEGIN");
      await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
      const mathId = (await c.query("insert into tenancy.subject (id, organization_id, name, code) values (app.uuid_generate_v7(), $1, 'ریاضیات', 'A-MTH') returning id", [f.ORG_A])).rows[0].id as string;
      await c.query("COMMIT");

      const first = await ensureOrgObjectivesWith(c, f.ORG_A);
      expect(first).toMatchObject({ organizations: 1, skipped: 0, created: G1_TOTAL, updated: 0, archived: 0 });

      const rows = await rowsOf<{ month: number; subject_name: string; sort_order: number; subject_id: string | null; domain: string | null; status: string }>(
        c,
        f.ORG_A,
        "select month, subject_name, sort_order, subject_id, domain, status from academic.learning_objective order by month, subject_name, sort_order",
      );
      expect(rows).toHaveLength(G1_TOTAL);
      expect(rows.every((r) => r.status === "active")).toBe(true);
      expect(rows.filter((r) => r.subject_name === "ریاضی").every((r) => r.subject_id === mathId)).toBe(true);
      expect(rows.filter((r) => r.subject_name !== "ریاضی").every((r) => r.subject_id === null)).toBe(true);
      const audited = await rowsOf<{ action: string; n: number }>(c, f.ORG_A, "select action, count(*)::int as n from audit.audit_log where entity_table = 'learning_objective' group by action");
      expect(audited).toEqual([{ action: "academic.learning_objective.seeded", n: 1 }]);

      const again = await seedOrgObjectivesWith(c);
      expect(again).toMatchObject({ created: expect.any(Number), updated: 0, archived: 0 });
      const repeat = await ensureOrgObjectivesWith(c, f.ORG_A);
      expect(repeat).toEqual({ organizations: 1, skipped: 0, created: 0, updated: 0, archived: 0, linked: 0 });
    });
  });

  it("a corrected wording updates the SAME row (its rating stays); a dropped line is archived, not deleted", async () => {
    await owner(async (c) => {
      const before = await rowsOf<{ id: string; sort_order: number; text: string }>(
        c,
        f.ORG_A,
        "select id, sort_order, text from academic.learning_objective where month = 7 and subject_name = 'قرآن' order by sort_order",
      );
      const last = before.at(-1)!;
      // A rating on the objective that is about to disappear: archiving must keep both rows.
      await c.query("BEGIN");
      await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
      await c.query(
        "insert into academic.objective_rating (id, organization_id, academic_year_id, student_profile_id, learning_objective_id, rating, rated_by_person_id) values (app.uuid_generate_v7(), $1, $2, $3, $4, 'good', $5)",
        [f.ORG_A, f.YEAR_A, f.STUDENT_A1, last.id, f.PERSON_A2],
      );
      await c.query("COMMIT");

      const res = await ensureOrgObjectivesWith(c, f.ORG_A, edited());
      expect(res).toMatchObject({ created: 0, updated: 1, archived: 1 });

      const after = await rowsOf<{ id: string; sort_order: number; text: string; status: string; archived_at: Date | null }>(
        c,
        f.ORG_A,
        "select id, sort_order, text, status, archived_at from academic.learning_objective where month = 7 and subject_name = 'قرآن' order by sort_order",
      );
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
      expect(after[0].text).toBe(`${before[0].text} (ویرایش‌شده)`);
      expect(after.at(-1)).toMatchObject({ id: last.id, status: "archived" });
      expect(after.at(-1)!.archived_at).not.toBeNull();
      const ratings = await rowsOf<{ n: number }>(c, f.ORG_A, "select count(*)::int as n from academic.objective_rating where learning_objective_id = $1", [last.id]);
      expect(ratings[0].n).toBe(1);

      // The original file again: the archived position comes back to life, the wording returns.
      const back = await ensureOrgObjectivesWith(c, f.ORG_A);
      expect(back).toMatchObject({ created: 0, updated: 2, archived: 0 });
    });
  });

  it("is invisible to another organisation and read-only for the runtime role", async () => {
    await owner(async (c) => {
      const other = await rowsOf<{ n: number }>(c, f.ORG_B, "select count(*)::int as n from academic.learning_objective where organization_id = $1", [f.ORG_A]);
      expect(other[0].n).toBe(0);
    });
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
        const seen = await c.query<{ n: number }>("select count(*)::int as n from academic.learning_objective");
        expect(seen.rows[0].n).toBe(G1_TOTAL);
        const err = await c.query("update academic.learning_objective set text = 'x'").catch((e: unknown) => e);
        expect(pgCode(err)).toBe(PG.INSUFFICIENT_PRIVILEGE);
      });
    });
  });
});
