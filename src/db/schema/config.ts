import { boolean, foreignKey, jsonb, pgSchema, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common";
import { orgFk, school } from "./tenancy";

export const config = pgSchema("config");

/**
 * Per-organization switches, overridden per school (`school_id`, migration 0026). No global flags table: the default
 * of every key lives in code (src/modules/config/flags.ts); a row exists only where an admin set a value.
 * Precedence: school row > organization row (`school_id NULL`) > code default.
 */
export const featureFlag = config.table(
  "feature_flag",
  {
    id: id(),
    organizationId: orgFk(),
    schoolId: uuid("school_id"),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    unique("feature_flag_org_school_key_uq").on(t.organizationId, t.schoolId, t.key).nullsNotDistinct(),
    foreignKey({
      name: "feature_flag_school_fk",
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [school.organizationId, school.id],
    }).onDelete("restrict"),
  ],
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
