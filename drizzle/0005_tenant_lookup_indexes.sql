CREATE INDEX "class_group_org_year_idx" ON "tenancy"."class_group" USING btree ("organization_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "class_group_org_grade_idx" ON "tenancy"."class_group" USING btree ("organization_id","grade_level_id");--> statement-breakpoint
CREATE INDEX "class_offering_org_subject_idx" ON "tenancy"."class_offering" USING btree ("organization_id","subject_id");--> statement-breakpoint
CREATE INDEX "class_offering_org_term_idx" ON "tenancy"."class_offering" USING btree ("organization_id","term_id");--> statement-breakpoint
CREATE INDEX "organization_membership_account_idx" ON "iam"."organization_membership" USING btree ("user_account_id");--> statement-breakpoint
CREATE INDEX "role_assignment_role_idx" ON "iam"."role_assignment" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "role_assignment_org_school_idx" ON "iam"."role_assignment" USING btree ("organization_id","school_id") WHERE "iam"."role_assignment"."school_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "role_assignment_org_branch_idx" ON "iam"."role_assignment" USING btree ("organization_id","branch_id") WHERE "iam"."role_assignment"."branch_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "role_assignment_org_class_group_idx" ON "iam"."role_assignment" USING btree ("organization_id","class_group_id") WHERE "iam"."role_assignment"."class_group_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "role_assignment_org_class_offering_idx" ON "iam"."role_assignment" USING btree ("organization_id","class_offering_id") WHERE "iam"."role_assignment"."class_offering_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "role_assignment_org_student_profile_idx" ON "iam"."role_assignment" USING btree ("organization_id","student_profile_id") WHERE "iam"."role_assignment"."student_profile_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "role_permission_permission_idx" ON "iam"."role_permission" USING btree ("permission_code");