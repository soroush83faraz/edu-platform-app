// «کارنامهٴ توصیفی» — installs the primary-school learning objectives (scripts/data/primary-objectives.json, the
// school's six documents as data) as `academic.learning_objective` rows of EVERY organisation that has the primary
// پایه‌ها (G1…G6 of the fixed catalog — i.e. every organisation once `ensureOrgCatalogWith` ran), in plain SQL over a
// `pg`-shaped `query()` like ./catalog: `scripts/seed.ts --catalog` (pnpm seed, the pilot/demo seeds, the int tests)
// and the deploy's compiled `scripts/seed-catalog.js` both call it, right after the structure catalog.
//
// Imports: the JSON, the import-free vocabulary module and a TYPE from ./catalog — nothing else (the bundle that runs
// inside the standalone image carries only `pg`; scripts/build-seed-catalog.ts inlines the JSON).
//
// Semantics (idempotent, additive — production never loses a rated objective):
//   • the natural key is the POSITION (organisation, پایه, month, درس, sort_order): a row at that position is
//     reused; a changed wording or domain UPDATES it in place (its ratings stay; one audit row per changed objective
//     with the old and new text), a missing one is INSERTED;
//   • an active row the JSON no longer has is ARCHIVED (status + archived_at), never deleted; it comes back to
//     `active` if the JSON has that position again;
//   • `subject_id` follows the organisation's own درس rows: the first `tenancy.subject` whose name matches the
//     canonical name or an alias (`objectiveNameKey`) is linked; NULL when there is none (e.g. «شایستگی‌های عمومی»);
//   • one transaction per organisation with the tenant bound for FORCE RLS; one summary audit row when anything
//     changed. A second run writes nothing (tests/int/objectives-catalog.test.ts).
import objectivesJson from "./data/primary-objectives.json";
import { objectiveNameKey, PRIMARY_SUBJECTS, type PrimaryObjectivesFile } from "../src/modules/academic/primary-objectives";
import type { Queryable } from "./catalog";

/** The committed objectives (scripts/build-primary-objectives.ts writes the file). */
export const PRIMARY_OBJECTIVES = objectivesJson as unknown as PrimaryObjectivesFile;

export interface ObjectiveSeedCounts {
  organizations: number;
  /** Organisations without any primary پایه (nothing to install). */
  skipped: number;
  created: number;
  updated: number;
  archived: number;
  /** Rows whose `subject_id` link was set or changed. */
  linked: number;
}

const emptyCounts = (): ObjectiveSeedCounts => ({ organizations: 0, skipped: 0, created: 0, updated: 0, archived: 0, linked: 0 });

interface ExistingRow {
  id: string;
  grade_level_id: string;
  month: number;
  subject_name: string;
  sort_order: number;
  text: string;
  domain: string | null;
  subject_id: string | null;
  status: string;
}

interface WantedRow {
  gradeLevelId: string;
  month: number;
  subjectName: string;
  sortOrder: number;
  text: string;
  domain: string | null;
  subjectId: string | null;
}

const keyOf = (gradeLevelId: string, month: number, subjectName: string, sortOrder: number) => `${gradeLevelId}|${month}|${subjectName}|${sortOrder}`;

async function auditObjective(q: Queryable, orgId: string, action: string, id: string | null, before: unknown, after: unknown): Promise<void> {
  await q.query(
    `insert into audit.audit_log (id, organization_id, actor_person_id, actor_user_id, request_id, action, entity_schema, entity_table, entity_id, before, after)
     values (app.uuid_generate_v7(), $1, null, null, 'seed-catalog', $2, 'academic', 'learning_objective', $3, $4::jsonb, $5::jsonb)`,
    [orgId, action, id, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)],
  );
}

/** The organisation's subject row per canonical درس (first by code), matched on the name or an alias. */
function matchSubjects(rows: ReadonlyArray<{ id: string; name: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of PRIMARY_SUBJECTS) {
    const keys = new Set([s.name, ...s.aliases].map(objectiveNameKey));
    const row = rows.find((r) => keys.has(objectiveNameKey(r.name)));
    if (row) out.set(s.name, row.id);
  }
  return out;
}

/**
 * The objectives of ONE organisation, in its own transaction on `q` (a single connection: a `pg.Client` or a
 * checked-out PoolClient) with the tenant bound for FORCE RLS. See the file header for the rules.
 */
export async function ensureOrgObjectivesWith(q: Queryable, orgId: string, file: PrimaryObjectivesFile = PRIMARY_OBJECTIVES): Promise<ObjectiveSeedCounts> {
  const counts = emptyCounts();
  counts.organizations = 1;
  await q.query("BEGIN");
  try {
    await q.query("select set_config('app.current_org_id', $1, true)", [orgId]);
    const gradeRows = (await q.query("select id, code from tenancy.grade_level where code = any($1::text[])", [file.grades.map((g) => g.gradeCode)])).rows as unknown as Array<{ id: string; code: string }>;
    if (gradeRows.length === 0) {
      counts.skipped = 1;
      await q.query("COMMIT");
      return counts;
    }
    const gradeIdOf = new Map(gradeRows.map((g) => [g.code, g.id]));
    const subjects = matchSubjects((await q.query("select id, name from tenancy.subject order by code, id")).rows as unknown as Array<{ id: string; name: string }>);

    const wanted: WantedRow[] = [];
    for (const g of file.grades) {
      const gradeLevelId = gradeIdOf.get(g.gradeCode);
      if (!gradeLevelId) continue;
      for (const m of g.months) {
        for (const s of m.subjects) {
          s.objectives.forEach((o, i) => {
            wanted.push({ gradeLevelId, month: m.month, subjectName: s.name, sortOrder: i + 1, text: o.text, domain: o.domain, subjectId: subjects.get(s.name) ?? null });
          });
        }
      }
    }

    const existing = (
      await q.query(
        "select id, grade_level_id, month, subject_name, sort_order, text, domain, subject_id, status from academic.learning_objective order by grade_level_id, month, subject_name, sort_order",
      )
    ).rows as unknown as ExistingRow[];
    const byKey = new Map(existing.map((r) => [keyOf(r.grade_level_id, Number(r.month), r.subject_name, Number(r.sort_order)), r]));
    const seen = new Set<string>();

    const inserts: WantedRow[] = [];
    const updates: Array<{ id: string; w: WantedRow }> = [];
    for (const w of wanted) {
      const key = keyOf(w.gradeLevelId, w.month, w.subjectName, w.sortOrder);
      seen.add(key);
      const row = byKey.get(key);
      if (!row) {
        inserts.push(w);
        continue;
      }
      const wordingChanged = row.text !== w.text || row.domain !== w.domain;
      const linkChanged = row.subject_id !== w.subjectId;
      const revived = row.status !== "active";
      if (!wordingChanged && !linkChanged && !revived) continue;
      updates.push({ id: row.id, w });
      if (linkChanged) counts.linked++;
      if (wordingChanged || revived) {
        counts.updated++;
        await auditObjective(q, orgId, "academic.learning_objective.updated", row.id, { text: row.text, domain: row.domain, status: row.status }, { text: w.text, domain: w.domain, status: "active" });
      }
    }

    if (inserts.length > 0) {
      await q.query(
        `insert into academic.learning_objective (id, organization_id, grade_level_id, month, subject_name, subject_id, domain, text, sort_order)
         select app.uuid_generate_v7(), $1, u.g, u.m, u.s, u.sid, u.d, u.t, u.o
         from unnest($2::uuid[], $3::smallint[], $4::text[], $5::uuid[], $6::text[], $7::text[], $8::smallint[]) as u(g, m, s, sid, d, t, o)`,
        [
          orgId,
          inserts.map((w) => w.gradeLevelId),
          inserts.map((w) => w.month),
          inserts.map((w) => w.subjectName),
          inserts.map((w) => w.subjectId),
          inserts.map((w) => w.domain),
          inserts.map((w) => w.text),
          inserts.map((w) => w.sortOrder),
        ],
      );
      counts.created = inserts.length;
    }
    if (updates.length > 0) {
      await q.query(
        `update academic.learning_objective lo
         set text = u.t, domain = u.d, subject_id = u.sid, status = 'active', archived_at = null
         from unnest($1::uuid[], $2::text[], $3::text[], $4::uuid[]) as u(id, t, d, sid)
         where lo.id = u.id`,
        [updates.map((x) => x.id), updates.map((x) => x.w.text), updates.map((x) => x.w.domain), updates.map((x) => x.w.subjectId)],
      );
    }
    const gone = existing.filter((r) => r.status === "active" && !seen.has(keyOf(r.grade_level_id, Number(r.month), r.subject_name, Number(r.sort_order))));
    if (gone.length > 0) {
      await q.query("update academic.learning_objective set status = 'archived', archived_at = now() where id = any($1::uuid[])", [gone.map((r) => r.id)]);
      for (const r of gone) await auditObjective(q, orgId, "academic.learning_objective.archived", r.id, { text: r.text, month: Number(r.month), subjectName: r.subject_name, sortOrder: Number(r.sort_order) }, { status: "archived" });
      counts.archived = gone.length;
    }
    if (counts.created + counts.updated + counts.archived + counts.linked > 0) {
      await auditObjective(q, orgId, "academic.learning_objective.seeded", null, null, { created: counts.created, updated: counts.updated, archived: counts.archived, linked: counts.linked, total: wanted.length });
    }
    await q.query("COMMIT");
    return counts;
  } catch (err) {
    await q.query("ROLLBACK");
    throw err;
  }
}

/** `ensureOrgObjectivesWith` for every organisation (the deploy's catalog step, `pnpm seed`); one transaction each. */
export async function seedOrgObjectivesWith(q: Queryable, file: PrimaryObjectivesFile = PRIMARY_OBJECTIVES): Promise<ObjectiveSeedCounts> {
  const total = emptyCounts();
  const orgs = (await q.query("select id from tenancy.organization order by id")).rows as unknown as Array<{ id: string }>;
  for (const o of orgs) {
    const c = await ensureOrgObjectivesWith(q, o.id, file);
    for (const k of Object.keys(total) as Array<keyof ObjectiveSeedCounts>) total[k] += c[k];
  }
  return total;
}

/** The third summary line both CLIs print — only zeros after the first run. */
export function formatObjectivesSummary(c: ObjectiveSeedCounts): string {
  return `[seed] learning objectives: ${c.organizations} organizations (${c.skipped} without primary grades); created ${c.created}, updated ${c.updated}, archived ${c.archived}, subject links ${c.linked}`;
}
