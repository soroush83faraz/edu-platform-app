// config/repo — rows of config.feature_flag and config.setting_value in the transaction's organization (RLS). Explicit
// columns, `tx` from the caller. A row exists only where an admin set a value; removing it = «پیروی از سطح بالاتر».
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import type { FlagRow } from "./flags";
import { featureFlag, settingValue } from "./schema";
import type { SettingRow } from "./settings";

export async function listFlagRows(tx: Tx): Promise<FlagRow[]> {
  return tx.select({ key: featureFlag.key, schoolId: featureFlag.schoolId, enabled: featureFlag.enabled }).from(featureFlag);
}

export async function listSettingRows(tx: Tx): Promise<SettingRow[]> {
  return tx.select({ key: settingValue.key, schoolId: settingValue.schoolId, value: settingValue.value }).from(settingValue);
}

const flagAt = (key: string, schoolId: string | null) => and(eq(featureFlag.key, key), schoolId === null ? isNull(featureFlag.schoolId) : eq(featureFlag.schoolId, schoolId));
const settingAt = (key: string, schoolId: string | null) => and(eq(settingValue.key, key), schoolId === null ? isNull(settingValue.schoolId) : eq(settingValue.schoolId, schoolId));

/** The row at exactly this level, locked for the change. */
export async function findFlagForUpdate(tx: Tx, key: string, schoolId: string | null): Promise<{ id: string; enabled: boolean } | null> {
  const [row] = await tx.select({ id: featureFlag.id, enabled: featureFlag.enabled }).from(featureFlag).where(flagAt(key, schoolId)).for("update");
  return row ?? null;
}

export async function insertFlag(tx: Tx, orgId: string, key: string, schoolId: string | null, enabled: boolean): Promise<string> {
  const [row] = await tx.insert(featureFlag).values({ organizationId: orgId, key, schoolId, enabled }).returning({ id: featureFlag.id });
  return row.id;
}

export async function updateFlag(tx: Tx, id: string, enabled: boolean): Promise<void> {
  await tx.update(featureFlag).set({ enabled }).where(eq(featureFlag.id, id));
}

export async function deleteFlag(tx: Tx, id: string): Promise<void> {
  await tx.delete(featureFlag).where(eq(featureFlag.id, id));
}

export async function findSettingForUpdate(tx: Tx, key: string, schoolId: string | null): Promise<{ id: string; value: unknown } | null> {
  const [row] = await tx.select({ id: settingValue.id, value: settingValue.value }).from(settingValue).where(settingAt(key, schoolId)).for("update");
  return row ?? null;
}

export async function insertSetting(tx: Tx, orgId: string, key: string, schoolId: string | null, value: unknown): Promise<string> {
  const [row] = await tx.insert(settingValue).values({ organizationId: orgId, key, schoolId, value }).returning({ id: settingValue.id });
  return row.id;
}

export async function updateSetting(tx: Tx, id: string, value: unknown): Promise<void> {
  await tx.update(settingValue).set({ value }).where(eq(settingValue.id, id));
}

export async function deleteSetting(tx: Tx, id: string): Promise<void> {
  await tx.delete(settingValue).where(eq(settingValue.id, id));
}
