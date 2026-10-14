-- «کارنامهٴ توصیفی» — the learning objectives are keyed by their CONTENT, no longer by their position (security review
-- 2026-10-14, D4; docs/decisions.md). Until now the catalog seed matched a document line to a row by
-- (organization, grade, month, subject_name, sort_order) and rewrote the row's text in place, so inserting or removing
-- ONE line in a corrected document shifted every line after it onto its neighbour's row — and silently re-labelled
-- the ratings already given (a student's «خیلی خوب» moved to an objective nobody rated).
--
-- 1) app.objective_text_hash(text): md5 of the wording with its orthography folded — Arabic ي ى ك ة ۀ and أ إ آ ٱ to
--    their Persian base letter, Persian/Arabic-Indic digits to ASCII, whitespace / ZWNJ / ZWJ / bidi marks /
--    tatweel / diacritics (incl. the written hamza) / punctuation removed, Latin lower-cased. A spelling or spacing
--    fix keeps the key (the seed updates that row's text in place, its ratings stay); any change of WORDS is a new
--    key. IMMUTABLE (it feeds a stored generated column). Never change it in place: CREATE OR REPLACE does not
--    recompute the stored values (PG16 has no SET EXPRESSION — see 0013), so the seed would see every row as new; a
--    new normalisation needs the column dropped and re-added in the same migration.
-- 2) learning_objective.text_hash — GENERATED ALWAYS AS (app.objective_text_hash(text)) STORED NOT NULL. Adding it
--    rewrites the table and computes every existing row: that IS the backfill (no UPDATE needed, none possible).
-- 3) learning_objective_text_uq UNIQUE (organization, grade, month, subject_name, text_hash) — over EVERY row, active
--    or archived, so a wording that comes back revives its archived row (and its ratings) instead of inserting a twin.
--    sort_order becomes a plain column the seed updates when the document's order changes.
-- 4) DROP learning_objective_slot_uq (the position key). Dropping a constraint is not additive, and it is justified
--    here: (a) the position key IS the defect — kept, it would refuse the very rows the content key needs (an archived
--    line keeps its old sort_order while the line now at that position is active; a line inserted mid-list moves every
--    later sort_order, and two rows swap positions inside one UPDATE); (b) migration 0017, which created it, has never
--    been applied in production (only on development/test databases), so no deployed code relies on it and no
--    production row is touched — this is the table's first shape in production. The new unique is added BEFORE the
--    old one is dropped, so the table is never without a natural key.
CREATE OR REPLACE FUNCTION app.objective_text_hash(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
  SELECT md5(lower(regexp_replace(
    translate(t, 'يىكةۀأإآٱ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', 'ییکههاااا01234567890123456789'),
    E'[\\s ​-‏⁠﻿ـً-ٰٟ.,:;!?()"''/،؛؟٫٬«»‐-―…-]',
    '', 'g')))
$fn$;
--> statement-breakpoint
ALTER TABLE "academic"."learning_objective" ADD COLUMN "text_hash" text GENERATED ALWAYS AS (app.objective_text_hash(text)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "academic"."learning_objective" ADD CONSTRAINT "learning_objective_text_uq" UNIQUE("organization_id","grade_level_id","month","subject_name","text_hash");--> statement-breakpoint
ALTER TABLE "academic"."learning_objective" DROP CONSTRAINT "learning_objective_slot_uq";
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
