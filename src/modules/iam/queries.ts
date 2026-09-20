// Read-only queries for pages (Server Components). Same gate as actions: session → must-change → permission.
import { count } from "drizzle-orm";
import { defineQuery } from "@/lib/actions";
import { person } from "./schema";

/** Number of persons in the caller's organization (organization-level `iam.person.read`). */
export const countPersonsInOrg = defineQuery({ permission: "iam.person.read" }, async (tx) => {
  const rows = await tx.select({ n: count() }).from(person);
  return rows[0]?.n ?? 0;
});
