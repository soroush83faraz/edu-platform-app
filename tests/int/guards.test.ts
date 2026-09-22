// Medium-severity guards from the DB hardening pass: role_assignment valid range CHECK (0008), server-side
// updated_at trigger on every table that has the column (0009), fa_norm diacritics/tatweel stripping (0009) and the
// app_rw role settings (01-roles.sh / operator step on existing clusters).
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { person, roleAssignment } from "@/db/schema";
import * as f from "./fixtures";
import { PG, Rollback, asAppRw, inRolledBackTx, pgCode } from "./helpers";

const ctxA = { orgId: f.ORG_A };
const ORG_CTX = "select set_config('app.current_org_id', $1, true)";

describe("role_assignment_valid_range_chk", () => {
  const base = { organizationId: f.ORG_A, personId: f.PERSON_A1, roleId: f.ROLE_A, scopeType: "organization" } as const;

  it("valid_from > valid_to is rejected (23514)", async () => {
    await expect(
      withTenant(ctxA, (tx) => tx.insert(roleAssignment).values({ ...base, validFrom: "2026-10-01", validTo: "2026-09-30" })),
    ).rejects.toSatisfy((err: unknown) => pgCode(err) === PG.CHECK_VIOLATION);
  });

  it("valid_from = valid_to and an open-ended valid_to are accepted (rolled back)", async () => {
    for (const range of [{ validFrom: "2026-09-30", validTo: "2026-09-30" }, { validFrom: "2026-09-30", validTo: null }]) {
      await expect(
        withTenant(ctxA, async (tx) => {
          const [row] = await tx.insert(roleAssignment).values({ ...base, ...range }).returning({ id: roleAssignment.id });
          expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
    }
  });
});

describe("updated_at is maintained by the server (app.set_updated_at)", () => {
  it("every base table with an updated_at column has the BEFORE UPDATE trigger", async () => {
    await asAppRw(async (c) => {
      const res = await c.query<{ table: string; has_trigger: boolean }>(
        `select c.table_schema || '.' || c.table_name as table,
                exists (select 1 from pg_trigger tg
                         join pg_class cl on cl.oid = tg.tgrelid
                         join pg_namespace n on n.oid = cl.relnamespace
                        where n.nspname = c.table_schema and cl.relname = c.table_name
                          and tg.tgname = 'set_updated_at' and not tg.tgisinternal
                          and tg.tgenabled = 'O'
                          and (tg.tgtype & 2) = 2      -- BEFORE
                          and (tg.tgtype & 16) = 16    -- UPDATE
                          and (tg.tgtype & 1) = 1) as has_trigger  -- FOR EACH ROW
           from information_schema.columns c
           join information_schema.tables t
             on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
          where c.column_name = 'updated_at'
            and c.table_schema in ('tenancy','iam','academic','workspace','notif','files','audit','config','integ')
          order by 1`,
      );
      // 11 tenancy tables (school_period since 0015) + iam: auth_identity, contact_point, person, role,
      // role_assignment, staff_profile, student_profile, user_account (organization_membership, login_attempt,
      // user_session, permission, role_permission have no updated_at) + academic 6 (timetable_slot since 0015,
      // attendance_session + attendance_entry since 0016) + workspace: work_item_type, work_item, inbox_entry
      // + config: feature_flag, setting_value.
      expect(res.rows).toHaveLength(19 + 6 + 3 + 2);
      expect(res.rows.filter((r) => !r.has_trigger).map((r) => r.table)).toEqual([]);
    });
  });

  it("a raw UPDATE as app_rw gets updated_at = now() even when the statement writes a stale value", async () => {
    await asAppRw(async (c) => {
      await inRolledBackTx(c, async () => {
        await c.query(ORG_CTX, [f.ORG_A]);
        const before = await c.query<{ updated_at: Date }>("select updated_at from iam.person where id = $1", [f.PERSON_A1]);
        const upd = await c.query<{ updated_at: Date; tx_now: Date }>(
          "update iam.person set first_name = first_name, updated_at = '2000-01-01' where id = $1 returning updated_at, now() as tx_now",
          [f.PERSON_A1],
        );
        expect(upd.rowCount).toBe(1);
        expect(upd.rows[0].updated_at.getTime()).toBe(upd.rows[0].tx_now.getTime());
        expect(upd.rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(before.rows[0].updated_at.getTime());
      });
    });
  });

  it("an ORM update inside withTenant bumps updated_at past created_at (rolled back)", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const [row] = await tx
          .update(person)
          .set({ firstName: "علی" })
          .where(eq(person.id, f.PERSON_A1))
          .returning({ createdAt: person.createdAt, updatedAt: person.updatedAt, now: sql<string>`now()` });
        expect(row.updatedAt.getTime()).toBe(new Date(row.now).getTime());
        expect(row.updatedAt.getTime()).toBeGreaterThan(row.createdAt.getTime());
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});

describe("app.fa_norm", () => {
  it("strips Arabic diacritics and tatweel, keeps ZWNJ -> space and the letter/digit folding", async () => {
    await asAppRw(async (c) => {
      const cases: [input: string, expected: string][] = [
        ["محمّد", "محمد"], // shadda
        ["مـحـمد", "محمد"], // tatweel
        ["عَلِيٌ", "علی"], // fatha, kasra, dammatan + Arabic yeh
        ["علي‌رضا كريمي", "علی رضا کریمی"], // ZWNJ + Arabic yeh/kaf (unchanged behaviour)
        ["۱۲۳ ٤٥٦ ABC", "123 456 abc"],
        ["  a \t b  ", " a b "],
      ];
      for (const [input, expected] of cases) {
        const r = await c.query<{ out: string }>("select app.fa_norm($1) as out", [input]);
        expect(r.rows[0].out, JSON.stringify(input)).toBe(expected);
      }
      const nul = await c.query<{ out: string }>("select app.fa_norm(null) as out");
      expect(nul.rows[0].out).toBe("");
    });
  });

  it("iam.person.search_text (STORED) uses the new normalization on insert (rolled back)", async () => {
    await expect(
      withTenant(ctxA, async (tx) => {
        const [row] = await tx
          .insert(person)
          .values({ organizationId: f.ORG_A, firstName: "محمّد", lastName: "مـحـمدی" })
          .returning({ searchText: person.searchText });
        expect(row.searchText).toBe("محمد محمدی");
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});

describe("app_rw role settings (01-roles.sh; operator step on existing clusters)", () => {
  it("statement_timeout 10s, idle_in_transaction_session_timeout 30s, lock_timeout 5s are in effect for app_rw", async () => {
    await asAppRw(async (c) => {
      const settings = await c.query<{ name: string; setting: string; unit: string | null }>(
        "select name, setting, unit from pg_settings where name in ('statement_timeout', 'idle_in_transaction_session_timeout', 'lock_timeout') order by 1",
      );
      expect(settings.rows).toEqual([
        { name: "idle_in_transaction_session_timeout", setting: "30000", unit: "ms" },
        { name: "lock_timeout", setting: "5000", unit: "ms" },
        { name: "statement_timeout", setting: "10000", unit: "ms" },
      ]);
    });
  });
});
