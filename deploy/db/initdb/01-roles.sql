-- Runs ONCE on first `db` start (empty pgdata) via /docker-entrypoint-initdb.d.
-- Written in the DB block. Will create:
--   role app_owner  (owns schemas; used only by migrate/seed via MIGRATION_DATABASE_URL)
--   role app_rw     (NOSUPERUSER NOBYPASSRLS, DML only; the app connects with this)
--   role app_backup (read-only; pg_dump)
--   databases app and app_test (C.UTF-8) with extensions btree_gist, pg_trgm
-- Passwords come from APP_OWNER_PASSWORD / APP_RW_PASSWORD / APP_BACKUP_PASSWORD (compose env).
SELECT 1;
