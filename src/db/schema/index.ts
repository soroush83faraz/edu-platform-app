// Single entry point for drizzle-kit (drizzle.config.ts) and the Drizzle client.
// One file per PostgreSQL schema; module code imports via src/modules/<ctx>/schema.ts.
export * from "./tenancy";
export * from "./iam";
