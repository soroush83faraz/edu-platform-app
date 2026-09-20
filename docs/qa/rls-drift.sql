-- RLS drift: tenant-schema tables that have organization_id but are not ENABLE + FORCE ROW LEVEL SECURITY with at
-- least one policy. Expected result on any healthy database: (0 rows). Used by docs/ops/go-live-checklist.md and
-- docs/qa/security-probe.md; tests/int/rls-meta.test.ts asserts the same in CI.
--   docker compose exec -T db psql -U postgres -d app -f - < docs/qa/rls-drift.sql
select c.relnamespace::regnamespace || '.' || c.relname as tbl,
       c.relrowsecurity as enabled,
       c.relforcerowsecurity as forced,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c
join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
where c.relkind = 'r'
  and c.relnamespace::regnamespace::text in ('tenancy','iam','academic','workspace','notif','files','audit','config','integ')
  and (not c.relrowsecurity or not c.relforcerowsecurity
       or not exists (select 1 from pg_policy p where p.polrelid = c.oid))
order by 1;
