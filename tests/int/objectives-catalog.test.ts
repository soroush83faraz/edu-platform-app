// «کارنامهٴ توصیفی» — the catalog step that installs the primary learning objectives (scripts/objectives-catalog.ts,
// migrations 0017 + 0019): every objective of the JSON for each پایه the organisation has (the fixture's ORG_A has
// only G1), a second run writes nothing, the organisation's matching درس row is linked, and the runtime role may only
// READ the table. The natural key is the CONTENT (0019): inserting a line mid-list keeps every existing rating on its
// own wording (only `sort_order` moves); a spelling fix updates the row in place; a reworded line is a NEW row and the
// old one is ARCHIVED with its rating — which the student's report card still shows, marked, while the entry roster
// offers the active wording only; a dropped line is archived, not deleted; the original document revives them.
// The step commits (one transaction per organisation), so afterAll re-creates the fixture database like
// org-catalog.test does.
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { classReportCards, getRatingSheet, type ReportCtx } from "@/modules/academic/report-card";
import { enrollStudent } from "@/modules/academic/service";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { PRIMARY_OBJECTIVES, ensureOrgObjectivesWith, seedOrgObjectivesWith } from "../../scripts/objectives-catalog";
import { runMigrations } from "../../scripts/migrate";
import type { PrimaryObjectivesFile } from "@/modules/academic/primary-objectives";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { PG, Rollback, asAppRw, inRolledBackTx, pgCode } from "./helpers";

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

type Objective = PrimaryObjectivesFile["grades"][number]["months"][number]["subjects"][number]["objectives"][number];

/** A copy of the JSON whose مهر قرآن list of پایهٔ اول (the original five lines `o`) is `edit(o)`. */
function withQuran(edit: (o: readonly Objective[]) => Objective[]): PrimaryObjectivesFile {
  const copy = structuredClone(PRIMARY_OBJECTIVES);
  const quran = copy.grades[0].months.find((m) => m.month === 7)!.subjects.find((s) => s.name === "قرآن")!;
  quran.objectives = edit(structuredClone(quran.objectives));
  return copy;
}

const NEW_LINE: Objective = { text: "آیه‌های آموخته‌شده را با صدای بلند و شمرده می‌خواند", domain: null };
/** A spelling fix only: the same words with a different spacing and a full stop — the content key does not change. */
const respell = (text: string): string => `${text.replace(/\u200c/g, " ")}.`;
const respelled = (o: Objective): Objective => ({ ...o, text: respell(o.text) });
/** A changed wording: one more word — a new objective. */
const reword = (text: string): string => `${text} در کلاس`;
const reworded = (o: Objective): Objective => ({ ...o, text: reword(o.text) });

const ALL = PERMISSIONS.map((p) => p.code);
const admin: ReportCtx = {
  orgId: f.ORG_A,
  personId: f.PERSON_A2,
  userId: null,
  requestId: "int-objectives",
  assignments: [{ roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL }],
};

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
      expect(repeat).toEqual({ organizations: 1, skipped: 0, created: 0, updated: 0, reordered: 0, archived: 0, linked: 0 });
    });
  });

  it("the content is the key: a line inserted mid-list keeps every rating on its own wording; a spelling fix stays; a reworded line is a new objective and the old one keeps its rating", async () => {
    type Row = { id: string; sort_order: number; text: string; status: string; archived_at: Date | null };
    const quranRows = (c: Client) =>
      rowsOf<Row>(c, f.ORG_A, "select id, sort_order, text, status, archived_at from academic.learning_objective where month = 7 and subject_name = 'قرآن' order by sort_order, status, id");
    /** objective id → (its text, its rating) for every rating of the student — the label a rating is shown with. */
    const ratedWordings = (c: Client) =>
      rowsOf<{ id: string; text: string; rating: string }>(
        c,
        f.ORG_A,
        "select lo.id, lo.text, r.rating from academic.objective_rating r join academic.learning_objective lo on lo.id = r.learning_objective_id where r.student_profile_id = $1 order by lo.id",
        [f.STUDENT_A1],
      );
    await owner(async (c) => {
      const o = await quranRows(c); // the five original lines
      expect(o.map((r) => r.sort_order)).toEqual([1, 2, 3, 4, 5]);
      // The student's ratings on lines 1, 3 and 5.
      await c.query("BEGIN");
      await c.query("select set_config('app.current_org_id', $1, true)", [f.ORG_A]);
      for (const [i, rating] of [
        [0, "good"],
        [2, "very_good"],
        [4, "acceptable"],
      ] as const) {
        await c.query(
          "insert into academic.objective_rating (id, organization_id, academic_year_id, student_profile_id, learning_objective_id, rating, rated_by_person_id) values (app.uuid_generate_v7(), $1, $2, $3, $4, $5, $6)",
          [f.ORG_A, f.YEAR_A, f.STUDENT_A1, o[i].id, rating, f.PERSON_A2],
        );
      }
      await c.query("COMMIT");
      const rated = await ratedWordings(c);
      expect(rated.map((r) => [r.id, r.rating]).sort()).toEqual(
        [
          [o[0].id, "good"],
          [o[2].id, "very_good"],
          [o[4].id, "acceptable"],
        ].sort(),
      );

      // 1. A line inserted after the first one: one new row, the four after it only MOVE — no rating changes wording.
      const inserted = withQuran((lines) => [lines[0], NEW_LINE, ...lines.slice(1)]);
      expect(await ensureOrgObjectivesWith(c, f.ORG_A, inserted)).toMatchObject({ created: 1, updated: 0, reordered: 4, archived: 0 });
      const afterInsert = await quranRows(c);
      expect(afterInsert.map((r) => [r.text, r.sort_order, r.status])).toEqual([
        [o[0].text, 1, "active"],
        [NEW_LINE.text, 2, "active"],
        [o[1].text, 3, "active"],
        [o[2].text, 4, "active"],
        [o[3].text, 5, "active"],
        [o[4].text, 6, "active"],
      ]);
      // Every rated row is the same row, with the same wording and the same level, as before the insert.
      expect(await ratedWordings(c)).toEqual(rated);
      // A second run of the same document writes nothing.
      expect(await ensureOrgObjectivesWith(c, f.ORG_A, inserted)).toMatchObject({ created: 0, updated: 0, reordered: 0, archived: 0 });

      // 2. A spelling fix of the rated third line (spacing, a full stop): the SAME row, its text corrected, its rating kept.
      const respelt = withQuran((lines) => [lines[0], NEW_LINE, lines[1], respelled(lines[2]), lines[3], lines[4]]);
      expect(await ensureOrgObjectivesWith(c, f.ORG_A, respelt)).toMatchObject({ created: 0, updated: 1, reordered: 0, archived: 0 });
      const third = (await quranRows(c)).find((r) => r.id === o[2].id)!;
      expect(third).toMatchObject({ text: respell(o[2].text), status: "active", sort_order: 4 });
      expect((await ratedWordings(c)).find((r) => r.id === o[2].id)).toMatchObject({ rating: "very_good", text: respell(o[2].text) });

      // 3. The rated fifth line reworded and the fourth dropped: the new wording is a NEW row (no rating); the old
      //    fifth row is ARCHIVED with its text and its rating; the fourth is archived, not deleted.
      const rewritten = withQuran((lines) => [lines[0], NEW_LINE, lines[1], respelled(lines[2]), reworded(lines[4])]);
      expect(await ensureOrgObjectivesWith(c, f.ORG_A, rewritten)).toMatchObject({ created: 1, updated: 0, reordered: 0, archived: 2 });
      const afterReword = await quranRows(c);
      const fifth = afterReword.find((r) => r.id === o[4].id)!;
      expect(fifth).toMatchObject({ text: o[4].text, status: "archived" });
      expect(fifth.archived_at).not.toBeNull();
      expect(afterReword.find((r) => r.id === o[3].id)).toMatchObject({ status: "archived" });
      const newFifth = afterReword.find((r) => r.text === reword(o[4].text))!;
      expect(newFifth).toMatchObject({ status: "active", sort_order: 5 });
      expect(newFifth.id).not.toBe(o[4].id);
      expect((await ratedWordings(c)).map((r) => [r.id, r.text, r.rating])).toEqual(rated.map((r) => [r.id, r.id === o[2].id ? respell(o[2].text) : r.text, r.rating]));

      // 4. The report card of مهر shows the archived fifth line WITH its level, marked, after the active lines; the
      //    unrated archived fourth line is not on it; the entry roster offers the active wording only.
      try {
        await withTenant({ orgId: f.ORG_A, personId: f.PERSON_A2 }, async (tx) => {
          await enrollStudent(tx, admin, { studentProfileId: f.STUDENT_A1, classGroupId: f.CLASS_GROUP_A1 });
          const card = (await classReportCards(tx, admin, { classGroupId: f.CLASS_GROUP_A1, month: 7, studentProfileId: f.STUDENT_A1 })).cards[0];
          const quran = card.subjects.find((x) => x.name === "قرآن")!;
          expect(quran.objectives.map((x) => [x.text, x.rating, x.archived])).toEqual([
            [o[0].text, "good", false],
            [NEW_LINE.text, null, false],
            [o[1].text, null, false],
            [respell(o[2].text), "very_good", false],
            [reword(o[4].text), null, false],
            [o[4].text, "acceptable", true],
          ]);
          expect(quran.counts).toMatchObject({ good: 1, very_good: 1, acceptable: 1 });
          const sheet = await getRatingSheet(tx, admin, { classGroupId: f.CLASS_GROUP_A1, month: 7, subjectName: "قرآن" });
          expect(sheet.objectives.map((x) => x.text)).toEqual([o[0].text, NEW_LINE.text, o[1].text, respell(o[2].text), reword(o[4].text)]);
          expect(sheet.objectives.every((x) => !x.archived)).toBe(true);
          throw new Rollback();
        });
      } catch (err) {
        if (!(err instanceof Rollback)) throw err;
      }

      // 5. The original document again: the new rows are archived, the old ones come back (with their ratings),
      //    the spelling and the positions return.
      expect(await ensureOrgObjectivesWith(c, f.ORG_A)).toMatchObject({ created: 0, updated: 3, reordered: 1, archived: 2 });
      const back = (await quranRows(c)).filter((r) => r.status === "active");
      expect(back.map((r) => [r.id, r.text, r.sort_order])).toEqual(o.map((r) => [r.id, r.text, r.sort_order]));
      expect(await ratedWordings(c)).toEqual(rated);
      expect(await ensureOrgObjectivesWith(c, f.ORG_A)).toMatchObject({ created: 0, updated: 0, reordered: 0, archived: 0 });
    });
  });

  it("refuses a document with the same objective twice in one درس and month — nothing written", async () => {
    await owner(async (c) => {
      const before = await rowsOf<{ n: number }>(c, f.ORG_A, "select count(*)::int as n from academic.learning_objective");
      const twice = withQuran((lines) => [...lines, respelled(lines[0])]);
      await expect(ensureOrgObjectivesWith(c, f.ORG_A, twice)).rejects.toThrow(/the same objective twice/);
      expect(await rowsOf<{ n: number }>(c, f.ORG_A, "select count(*)::int as n from academic.learning_objective")).toEqual(before);
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
        // Its active objectives (the test above left two archived rows: an archive is never deleted).
        const seen = await c.query<{ n: number }>("select count(*)::int as n from academic.learning_objective where status = 'active'");
        expect(seen.rows[0].n).toBe(G1_TOTAL);
        const err = await c.query("update academic.learning_objective set text = 'x'").catch((e: unknown) => e);
        expect(pgCode(err)).toBe(PG.INSUFFICIENT_PRIVILEGE);
      });
    });
  });
});
