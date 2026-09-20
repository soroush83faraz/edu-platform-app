// Deterministic fixture ids shared between the global setup (which inserts them as app_owner) and the tests.
// Two organizations, A and B, each with the minimum graph needed to exercise RLS, composite FKs and CHECKs.

export const ORG_A = "0199a000-0000-7000-8000-0000000000aa";
export const ORG_B = "0199a000-0000-7000-8000-0000000000bb";

export const SCHOOL_A = "0199a000-0001-7000-8000-0000000000aa";
export const SCHOOL_B = "0199a000-0001-7000-8000-0000000000bb";

export const BRANCH_A = "0199a000-0002-7000-8000-0000000000aa";
export const BRANCH_B = "0199a000-0002-7000-8000-0000000000bb";

export const YEAR_A = "0199a000-0003-7000-8000-0000000000aa";
export const YEAR_B = "0199a000-0003-7000-8000-0000000000bb";

export const LEVEL_A = "0199a000-0004-7000-8000-0000000000aa";
export const LEVEL_B = "0199a000-0004-7000-8000-0000000000bb";

export const GRADE_A = "0199a000-0005-7000-8000-0000000000aa";
export const GRADE_B = "0199a000-0005-7000-8000-0000000000bb";

export const PERSON_A1 = "0199a000-0006-7000-8000-0000000000a1";
export const PERSON_A2 = "0199a000-0006-7000-8000-0000000000a2";
export const PERSON_B1 = "0199a000-0006-7000-8000-0000000000b1";

export const ROLE_A = "0199a000-0007-7000-8000-0000000000aa";
export const ROLE_B = "0199a000-0007-7000-8000-0000000000bb";
/** System template: organization_id IS NULL, inserted by app_owner. */
export const ROLE_TEMPLATE = "0199a000-0007-7000-8000-000000000000";

/** Academic graph (step 2): subject, term, two class groups, one offering, one student and one staff profile per org. */
export const SUBJECT_A = "0199a000-0009-7000-8000-0000000000aa";
export const SUBJECT_B = "0199a000-0009-7000-8000-0000000000bb";
export const TERM_A = "0199a000-000a-7000-8000-0000000000aa";
export const TERM_B = "0199a000-000a-7000-8000-0000000000bb";
export const CLASS_GROUP_A1 = "0199a000-000b-7000-8000-0000000000a1";
export const CLASS_GROUP_A2 = "0199a000-000b-7000-8000-0000000000a2";
export const CLASS_GROUP_B1 = "0199a000-000b-7000-8000-0000000000b1";
export const OFFERING_A1 = "0199a000-000c-7000-8000-0000000000a1";
export const OFFERING_B1 = "0199a000-000c-7000-8000-0000000000b1";
/** PERSON_A1 / PERSON_B1 are students, PERSON_A2 is staff. */
export const STUDENT_A1 = "0199a000-000d-7000-8000-0000000000a1";
export const STUDENT_B1 = "0199a000-000d-7000-8000-0000000000b1";
export const STAFF_A2 = "0199a000-000e-7000-8000-0000000000a2";

/** workspace.work_item_type: a system template (organization_id NULL) and a private type of A. */
export const WIT_TEMPLATE = "0199a000-000f-7000-8000-000000000000";
export const WIT_A = "0199a000-000f-7000-8000-0000000000aa";
/** workspace.work_item_status `open` of the template type; notif.notification_type code (both global catalogs). */
export const WIS_OPEN = "0199a000-0010-7000-8000-000000000000";
export const NT_CODE = "system.announcement";

export const PERSONS_IN_A = 2;
export const PERSONS_IN_B = 1;
