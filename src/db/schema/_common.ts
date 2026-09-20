import { timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

/** `id uuid PRIMARY KEY` — UUID v7 generated in the app (time-ordered, index friendly). */
export const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * `organization_id uuid NOT NULL` — the RLS key of every tenant table.
 * Each table adds `.references(() => organization.id, { onDelete: "restrict" })` itself.
 */
export const orgId = () => uuid("organization_id").notNull();

/** `created_at` / `updated_at` as `timestamptz` (UTC), both `DEFAULT now() NOT NULL`. */
export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
