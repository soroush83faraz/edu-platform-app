// Drizzle tables of the `iam` PostgreSQL schema. Definitions live in src/db/schema/iam.ts
// (drizzle-kit reads them from there); module code imports from here.
export {
  authIdentity,
  contactPoint,
  loginAttempt,
  organizationMembership,
  permission,
  person,
  role,
  roleAssignment,
  rolePermission,
  staffProfile,
  studentProfile,
  userAccount,
  userSession,
} from "@/db/schema/iam";
