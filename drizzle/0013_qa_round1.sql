ALTER TABLE "workspace"."work_item" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_idempotency_uq" ON "workspace"."work_item" USING btree ("organization_id","created_by_person_id","idempotency_key") WHERE "workspace"."work_item"."idempotency_key" IS NOT NULL;--> statement-breakpoint
-- QA round 1 (docs/decisions.md «QA round 1 fixes»):
-- 1) work_item.idempotency_key (above): the «کار جدید» form sends a client-generated UUID v7; createWorkItem returns the
--    existing item when the same (organization, creator, key) was used in the last 10 minutes, and the partial unique
--    index makes a concurrent double-submit a CONFLICT instead of a second item. Nullable + additive.
-- 2) app.fa_norm also folds alef-madda (آ U+0622) to alef, so «آرش» is found by «ارش» and vice versa. The function
--    feeds the GENERATED ... STORED column iam.person.search_text, which CREATE OR REPLACE does not recompute (PG16
--    has no ALTER COLUMN ... SET EXPRESSION), so the column and its trigram index are dropped and re-added — a derived
--    column, no data is lost; the rewrite is a few thousand rows on the pilot. Everything else in fa_norm is unchanged.
CREATE OR REPLACE FUNCTION app.fa_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(
    translate(
      regexp_replace(regexp_replace(coalesce(t, ''), '‌', ' ', 'g'), '[ً-ْـ]', '', 'g'),
      'يكةىأإآ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
      'یکهیااا01234567890123456789'),
    '\s+', ' ', 'g')) $$;
--> statement-breakpoint
ALTER TABLE "iam"."person" DROP COLUMN "search_text";
--> statement-breakpoint
ALTER TABLE "iam"."person" ADD COLUMN "search_text" text GENERATED ALWAYS AS (app.fa_norm(first_name || ' ' || last_name)) STORED;
--> statement-breakpoint
CREATE INDEX "person_search_text_trgm_idx" ON "iam"."person" USING gin ("search_text" gin_trgm_ops);
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
