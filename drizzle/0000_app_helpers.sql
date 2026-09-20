-- Custom migration: `app` schema helper functions. Must run BEFORE the table migration
-- (iam.person.search_text is GENERATED with app.fa_norm).
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
-- Tenant context set per transaction by withTenant() via set_config(..., true). NULL when unset -> RLS fails closed.
CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_person_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_person_id', true), '')::uuid $$;
--> statement-breakpoint
-- UUID v7 for SQL-side inserts (seed/fixtures). App code generates v7 ids itself (uuid.v7()).
CREATE OR REPLACE FUNCTION app.uuid_generate_v7() RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp())*1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid $$;
--> statement-breakpoint
-- Persian normalization for search: Arabic ي/ك/ة/ى/أ/إ -> Persian, Persian + Arabic-Indic digits -> ASCII,
-- ZWNJ (U+200C) -> space, whitespace runs collapsed, lower-cased. IMMUTABLE so it can back a generated column.
CREATE OR REPLACE FUNCTION app.fa_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(translate(coalesce(t,''), 'يكةىأإ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩‌', 'یکهیاا01234567890123456789 '), '\s+', ' ', 'g')) $$;
