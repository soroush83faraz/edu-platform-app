import { boolean, foreignKey, jsonb, pgSchema, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { orgFk, school } from "./tenancy";

export const config = pgSchema("config");

/** Per-organization switches (no global flags table: a flag that is off everywhere is simply absent). */
export const featureFlag = config.table(
  "feature_flag",
  {
    id: id(),
    organizationId: orgFk(),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [unique("feature_flag_org_key_uq").on(t.organizationId, t.key)],
);

/** Settings at organization level (`school_id NULL`) or overridden per school. */
export const settingValue = config.table(
  "setting_value",
  {
    id: id(),
    organizationId: orgFk(),
    schoolId: uuid("school_id"),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("setting_value_org_school_key_uq").on(t.organizationId, t.schoolId, t.key).nullsNotDistinct(),
    foreignKey({
      name: "setting_value_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
  ],
);
