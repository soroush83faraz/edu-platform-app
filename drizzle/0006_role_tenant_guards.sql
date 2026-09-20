-- Custom migration: tenant guards for the two plain FKs that point at iam.role.
--
-- `role_assignment.role_id -> role(id)` and `role.cloned_from_role_id -> role(id)` cannot be composite
-- `(organization_id, role_id)` FKs because role.organization_id is NULL for system templates, and referential
-- integrity checks bypass row security: org A could attach org B's private role by id. A constraint trigger closes
-- the gap: the referenced role must be a system template (NULL) or belong to the row's own organization.
--
-- SECURITY DEFINER (owner app_owner, fixed search_path) so the check does not depend on the invoking role's grants.
-- app_owner is FORCE-RLS-bound like everyone else, so a role of another tenant is simply NOT FOUND in that lookup;
-- NOT FOUND is rejected as well (fail closed) — a truly missing role is rejected by the FK with the same SQLSTATE.
-- Constraint triggers are AFTER ROW by definition (NOT DEFERRABLE: app_rw cannot postpone them with SET
-- CONSTRAINTS); trigger functions cannot be called directly, so the DEFINER body is reachable only through the
-- triggers below.
CREATE OR REPLACE FUNCTION app.check_role_assignment_role_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app AS $fn$
DECLARE
  role_org uuid;
BEGIN
  SELECT r.organization_id INTO role_org FROM iam.role r WHERE r.id = NEW.role_id;
  IF NOT FOUND OR (role_org IS NOT NULL AND role_org IS DISTINCT FROM NEW.organization_id) THEN
    RAISE EXCEPTION 'role_assignment.role_id % is neither a system template nor a role of organization %',
      NEW.role_id, NEW.organization_id
      USING ERRCODE = 'foreign_key_violation', SCHEMA = 'iam', TABLE = 'role_assignment',
            COLUMN = 'role_id', CONSTRAINT = 'role_assignment_role_tenant_trg';
  END IF;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.check_role_cloned_from_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app AS $fn$
DECLARE
  source_org uuid;
BEGIN
  IF NEW.cloned_from_role_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT r.organization_id INTO source_org FROM iam.role r WHERE r.id = NEW.cloned_from_role_id;
  IF NOT FOUND OR (source_org IS NOT NULL AND source_org IS DISTINCT FROM NEW.organization_id) THEN
    RAISE EXCEPTION 'role.cloned_from_role_id % is neither a system template nor a role of organization %',
      NEW.cloned_from_role_id, NEW.organization_id
      USING ERRCODE = 'foreign_key_violation', SCHEMA = 'iam', TABLE = 'role',
            COLUMN = 'cloned_from_role_id', CONSTRAINT = 'role_cloned_from_tenant_trg';
  END IF;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS role_assignment_role_tenant_trg ON iam.role_assignment;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER role_assignment_role_tenant_trg
  AFTER INSERT OR UPDATE OF role_id, organization_id ON iam.role_assignment
  FOR EACH ROW EXECUTE FUNCTION app.check_role_assignment_role_tenant();
--> statement-breakpoint
DROP TRIGGER IF EXISTS role_cloned_from_tenant_trg ON iam.role;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER role_cloned_from_tenant_trg
  AFTER INSERT OR UPDATE OF cloned_from_role_id, organization_id ON iam.role
  FOR EACH ROW EXECUTE FUNCTION app.check_role_cloned_from_tenant();
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
