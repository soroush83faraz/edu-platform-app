// config/queries — feature switches and settings for pages and layouts (Server Components). The organization's rows
// are read ONCE per request (React `cache` around one defineQuery; `iam.account.self` — every member may know which
// features are on) and resolved school > organization > default. Signed out, or on any failure, every key reads its
// default: a feature that defaults to off stays off.
//
//   if (await isEnabled("grade_appeals", schoolId)) …            const days = await getSetting("grades.appeal_window_days", schoolId);
//
// Inside a transaction (services, job handlers) use ./service `flagEnabled(tx, …)` / `settingOf(tx, …)` instead.
import { cache } from "react";
import { defineQuery } from "@/lib/actions";
import { SettingsPageInput } from "./dto";
import { type FlagKey, resolveFlag } from "./flags";
import { CONFIG_PERMISSION, type ConfigSnapshot, configSnapshot, settingsView } from "./service";
import { type SettingKey, type SettingValue, resolveSetting } from "./settings";

const snapshotQuery = defineQuery({ permission: "iam.account.self" }, (tx) => configSnapshot(tx));

const requestSnapshot = cache(async (): Promise<ConfigSnapshot> => {
  const r = await snapshotQuery();
  return r.ok ? r.data : { flags: [], settings: [] };
});

/** Is `key` on for this school (or the organization when no school is given), for the current request? */
export async function isEnabled(key: FlagKey, schoolId?: string | null): Promise<boolean> {
  return resolveFlag((await requestSnapshot()).flags, key, schoolId).enabled;
}

/** The value of `key` for this school (or the organization), for the current request. */
export async function getSetting<K extends SettingKey>(key: K, schoolId?: string | null): Promise<SettingValue<K>> {
  return resolveSetting((await requestSnapshot()).settings, key, schoolId).value;
}

/** The «تنظیمات» page at one level (null = the organization; a school-scoped caller falls back to their school). */
export const settingsPageQuery = defineQuery({ schema: SettingsPageInput, permission: CONFIG_PERMISSION, scope: "any" }, (tx, input, ctx) => settingsView(tx, ctx, input.schoolId));
