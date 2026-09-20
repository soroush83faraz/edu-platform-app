// Single entry point for drizzle-kit (drizzle.config.ts) and the Drizzle client.
// One file per PostgreSQL schema; module code imports via src/modules/<ctx>/schema.ts.
// Import order follows the dependency graph (tenancy <- iam <- files <- academic/workspace/notif/audit/config/integ).
export * from "./tenancy";
export * from "./iam";
export * from "./files";
export * from "./academic";
export * from "./workspace";
export * from "./notif";
export * from "./audit";
export * from "./config";
export * from "./integ";
