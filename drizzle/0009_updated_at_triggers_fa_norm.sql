-- Custom migration: server-side `updated_at` maintenance + fa_norm diacritics handling.
--
-- From here on every migration that adds a schema or a table MUST end with three separate statements:
--   SELECT app.apply_grants();  SELECT app.apply_rls();  SELECT app.apply_updated_at_triggers();
--
-- 1) `updated_at`: Drizzle's `$onUpdate` only runs for updates issued through the ORM; raw SQL, seeds and
--    ON CONFLICT DO UPDATE paths left the column stale. A BEFORE UPDATE trigger on every base table that has an
--    `updated_at` column makes the server authoritative. `app.apply_updated_at_triggers()` is idempotent like
--    apply_rls(): it (re)creates `set_updated_at` on every matching table found in information_schema.
CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.apply_updated_at_triggers() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.column_name = 'updated_at'
      AND c.table_schema IN ('tenancy','iam','academic','workspace','notif','files','audit','config','integ')
    ORDER BY 1, 2
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I.%I', r.table_schema, r.table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()',
      r.table_schema, r.table_name);
  END LOOP;
END
$fn$;
--> statement-breakpoint
-- 2) fa_norm: also drop Arabic diacritics (U+064B..U+0652: fathatan..sukun, incl. shadda) and tatweel (U+0640), so
--    'محمّد' and 'مـحمد' normalize to 'محمد'. ZWNJ (U+200C) still becomes a space (now written explicitly instead of
--    as an invisible character inside the translate() argument); letter folding, digit folding, whitespace
--    collapsing and lower-casing are unchanged. IMMUTABLE because iam.person.search_text is GENERATED ... STORED.
--    Stored values are NOT recomputed by CREATE OR REPLACE — no production rows exist yet; if that ever changes,
--    rebuild the column (PG16: drop + re-add search_text and its GIN index; PG17: ALTER COLUMN ... SET EXPRESSION).
CREATE OR REPLACE FUNCTION app.fa_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(
    translate(
      regexp_replace(regexp_replace(coalesce(t, ''), '‌', ' ', 'g'), '[ً-ْـ]', '', 'g'),
      'يكةىأإ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
      'یکهیاا01234567890123456789'),
    '\s+', ' ', 'g')) $$;
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
