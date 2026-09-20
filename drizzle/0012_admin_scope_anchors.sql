ALTER TABLE "academic"."school_enrollment" ALTER COLUMN "grade_level_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "iam"."staff_profile" ADD COLUMN "school_id" uuid;--> statement-breakpoint
ALTER TABLE "iam"."staff_profile" ADD CONSTRAINT "staff_profile_school_fk" FOREIGN KEY ("organization_id","school_id") REFERENCES "tenancy"."school"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "school_org_code_ci_uq" ON "tenancy"."school" USING btree ("organization_id",lower("code"));--> statement-breakpoint
CREATE INDEX "staff_profile_org_school_idx" ON "iam"."staff_profile" USING btree ("organization_id","school_id") WHERE "iam"."staff_profile"."school_id" IS NOT NULL;--> statement-breakpoint
-- Backfill the new anchor: staff who currently teach at exactly ONE school and hold no organization/school/branch
-- role get that school as their primary school. Staff with a manual manager role are already anchored by it and are
-- deliberately left alone (a principal of S1 who also teaches at S2 must NOT become manageable by the S2 admin).
-- app_owner is bound by FORCE RLS, so the update runs once per organization with the tenant context set
-- transaction-locally; the context is cleared again at the end so later statements of this migration run stay
-- fail-closed.
DO $backfill$
DECLARE
  o record;
BEGIN
  FOR o IN SELECT id FROM tenancy.organization LOOP
    PERFORM set_config('app.current_org_id', o.id::text, true);
    UPDATE iam.staff_profile sp
       SET school_id = x.school_id
      FROM (
        SELECT ta.staff_profile_id, min(b.school_id::text)::uuid AS school_id
          FROM academic.teacher_assignment ta
          JOIN tenancy.class_offering co ON co.id = ta.class_offering_id
          JOIN tenancy.class_group cg ON cg.id = co.class_group_id
          JOIN tenancy.branch b ON b.id = cg.branch_id
         WHERE ta.valid_to IS NULL
         GROUP BY ta.staff_profile_id
        HAVING count(DISTINCT b.school_id) = 1
      ) x
     WHERE sp.id = x.staff_profile_id
       AND sp.school_id IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM iam.role_assignment ra
          WHERE ra.person_id = sp.person_id
            AND ra.revoked_at IS NULL
            AND ra.scope_type IN ('organization', 'school', 'branch')
       );
  END LOOP;
  PERFORM set_config('app.current_org_id', '', true);
END
$backfill$;
--> statement-breakpoint
SELECT app.apply_grants();
--> statement-breakpoint
SELECT app.apply_rls();
--> statement-breakpoint
SELECT app.apply_updated_at_triggers();
