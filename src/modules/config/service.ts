// config/service — feature switches and settings of the transaction's organization, overridden per school (owner
// 2026-10-20, docs/decisions.md «صف، زمان‌بند و Feature Flag»). `(tx, ctx, input)`.
//
// Reading — `flagEnabled(tx, key, schoolId?)` / `settingOf(tx, key, schoolId?)` inside ANY transaction (an action's, a
// query's, a job handler's): the organization's rows are read once per transaction (`configSnapshot`, cached by the
// transaction object) and resolved school > organization > default (./flags, ./settings). Pages use the request-cached
// twins in ./queries (`isEnabled`, `getSetting`).
//
// Writing — `setFlag` / `setSetting` (the «تنظیمات» page, ./actions): the organization's value needs
// `config.settings.manage` at the ORGANIZATION (the organization admin); a school's value needs it at that school (its
// principal or vice principal — and the organization admin anywhere) and only for a school-overridable key. A school
// outside the caller's scope is NOT_FOUND. «پیروی» removes this level's row (pure configuration: the history is the
// audit trail). Every change is audited in the same transaction: `config.feature_flag.changed` /
// `config.setting_value.changed` with the key, the level and the before / after values (no personal data exists here).
import { eq, inArray } from "drizzle-orm";
import type { Ctx, Tx } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { forbidden, notFound, validation } from "@/lib/errors";
import { type AdminScope, assertSchoolInScope, getPermissionScope } from "@/modules/iam/service";
import { school } from "@/modules/tenancy/schema";
import { FEATURE_FLAGS, FLAG_KEYS, type FlagDef, type FlagKey, type FlagRow, type FlagSource, resolveFlag } from "./flags";
import { deleteFlag, deleteSetting, findFlagForUpdate, findSettingForUpdate, insertFlag, insertSetting, listFlagRows, listSettingRows, updateFlag, updateSetting } from "./repo";
import type { SetFlagInput, SetSettingInput } from "./dto";
import {
  SETTINGS,
  SETTING_KEYS,
  type SettingDef,
  type SettingKey,
  type SettingRow,
  type SettingSource,
  type SettingValue,
  type TimeRangeValue,
  parseSettingInput,
  resolveSetting,
  settingSchema,
} from "./settings";

export interface ConfigSnapshot {
  flags: FlagRow[];
  settings: SettingRow[];
}

const snapshots = new WeakMap<object, Promise<ConfigSnapshot>>();

/** The organization's flag and setting rows, read once per transaction. */
export function configSnapshot(tx: Tx): Promise<ConfigSnapshot> {
  let p = snapshots.get(tx);
  if (!p) {
    p = (async () => ({ flags: await listFlagRows(tx), settings: await listSettingRows(tx) }))();
    snapshots.set(tx, p);
  }
  return p;
}

export async function flagEnabled(tx: Tx, key: FlagKey, schoolId?: string | null): Promise<boolean> {
  return resolveFlag((await configSnapshot(tx)).flags, key, schoolId).enabled;
}

export async function settingOf<K extends SettingKey>(tx: Tx, key: K, schoolId?: string | null): Promise<SettingValue<K>> {
  return resolveSetting((await configSnapshot(tx)).settings, key, schoolId).value;
}

export const CONFIG_PERMISSION = "config.settings.manage" as const;

type ConfigCtx = Pick<Ctx, "orgId" | "personId" | "userId" | "requestId" | "ip" | "userAgent" | "assignments">;

/** May the caller write this level? Organization: org-scoped holders only. School: in scope, key overridable, school exists. */
async function assertMayEdit(tx: Tx, ctx: ConfigCtx, def: { schoolOverridable: boolean }, schoolId: string | null): Promise<AdminScope> {
  const scope = await getPermissionScope(tx, ctx, CONFIG_PERMISSION);
  if (schoolId === null) {
    if (scope.kind !== "organization") throw forbidden();
    return scope;
  }
  assertSchoolInScope(scope, schoolId);
  if (!def.schoolOverridable) throw forbidden("این مورد فقط در سطح سازمان تنظیم می‌شود.");
  const [row] = await tx.select({ id: school.id }).from(school).where(eq(school.id, schoolId));
  if (!row) throw notFound();
  return scope;
}

export async function setFlag(tx: Tx, ctx: ConfigCtx, input: SetFlagInput): Promise<{ enabled: boolean; source: FlagSource }> {
  const def: FlagDef = FEATURE_FLAGS[input.key];
  await assertMayEdit(tx, ctx, def, input.schoolId);
  const existing = await findFlagForUpdate(tx, input.key, input.schoolId);
  const before = existing ? existing.enabled : null;
  const after = input.value === "inherit" ? null : input.value === "on";
  let id = existing?.id ?? null;
  if (after === null) {
    if (existing) await deleteFlag(tx, existing.id);
  } else if (existing) {
    if (existing.enabled !== after) await updateFlag(tx, existing.id, after);
  } else {
    id = await insertFlag(tx, ctx.orgId, input.key, input.schoolId, after);
  }
  if (before !== after) {
    await audit(ctx, "config.feature_flag.changed", { schema: "config", table: "feature_flag", id }, { key: input.key, schoolId: input.schoolId, enabled: before }, { key: input.key, schoolId: input.schoolId, enabled: after }, tx);
  }
  snapshots.delete(tx);
  return resolveFlag((await configSnapshot(tx)).flags, input.key, input.schoolId);
}

export async function setSetting(tx: Tx, ctx: ConfigCtx, input: SetSettingInput): Promise<{ value: unknown; source: SettingSource }> {
  const def: SettingDef = SETTINGS[input.key];
  await assertMayEdit(tx, ctx, def, input.schoolId);
  let after: number | TimeRangeValue | null = null;
  if (input.mode === "set") {
    after = parseSettingInput(input.key, input);
    if (after === null) {
      const msg = def.kind === "int" ? `عددی از ${def.min.toLocaleString("fa-IR")} تا ${def.max.toLocaleString("fa-IR")} وارد کنید.` : "ساعت را به شکل ۲۲:۰۰ وارد کنید.";
      throw validation({ fieldErrors: { value: [msg] } }, msg);
    }
  }
  const existing = await findSettingForUpdate(tx, input.key, input.schoolId);
  const before = existing?.value ?? null;
  let id = existing?.id ?? null;
  if (after === null) {
    if (existing) await deleteSetting(tx, existing.id);
  } else if (existing) {
    await updateSetting(tx, existing.id, after);
  } else {
    id = await insertSetting(tx, ctx.orgId, input.key, input.schoolId, after);
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await audit(ctx, "config.setting_value.changed", { schema: "config", table: "setting_value", id }, { key: input.key, schoolId: input.schoolId, value: before }, { key: input.key, schoolId: input.schoolId, value: after }, tx);
  }
  snapshots.delete(tx);
  return resolveSetting((await configSnapshot(tx)).settings, input.key, input.schoolId);
}

// ---------------------------------------------------------------------------------------------------------------
// the «تنظیمات» page
// ---------------------------------------------------------------------------------------------------------------

export interface LevelOption {
  /** null = the organization. */
  schoolId: string | null;
  name: string;
}

export interface FlagView {
  key: FlagKey;
  labelFa: string;
  descriptionFa: string;
  upcoming: boolean;
  schoolOverridable: boolean;
  /** What applies at the viewed level, and where it comes from. */
  enabled: boolean;
  source: FlagSource;
  /** The value set at exactly this level (null = none: it follows the level above). */
  own: boolean | null;
  /** What applies without this level's value (the organization's or the default). */
  inherited: boolean;
}

export interface SettingView {
  key: SettingKey;
  labelFa: string;
  descriptionFa: string;
  upcoming: boolean;
  schoolOverridable: boolean;
  kind: SettingDef["kind"];
  unitFa: string | null;
  min: number | null;
  max: number | null;
  value: number | TimeRangeValue;
  source: SettingSource;
  own: number | TimeRangeValue | null;
  inherited: number | TimeRangeValue;
}

export interface SettingsPageView {
  /** The level shown: null = the organization. */
  schoolId: string | null;
  levels: LevelOption[];
  orgName: string;
  flags: FlagView[];
  settings: SettingView[];
}

/**
 * What the caller may see and change at one level: an organization-scoped holder gets the organization level and every
 * school; a school-scoped one only their schools (a request for the organization level, or a school outside the scope,
 * falls back to their first school / is NOT_FOUND) and only the school-overridable keys.
 */
export async function settingsView(tx: Tx, ctx: ConfigCtx & { orgName: string }, requested: string | null): Promise<SettingsPageView> {
  const scope = await getPermissionScope(tx, ctx, CONFIG_PERMISSION);
  const schools = await tx
    .select({ id: school.id, name: school.name })
    .from(school)
    .where(scope.kind === "organization" ? undefined : inArray(school.id, scope.schoolIds))
    .orderBy(school.name);
  if (requested !== null && !schools.some((s) => s.id === requested)) throw notFound();
  const schoolId = requested ?? (scope.kind === "organization" ? null : (schools[0]?.id ?? null));
  if (schoolId === null && scope.kind !== "organization") throw forbidden();
  const levels: LevelOption[] = [...(scope.kind === "organization" ? [{ schoolId: null, name: ctx.orgName }] : []), ...schools.map((s) => ({ schoolId: s.id, name: s.name }))];
  const { flags, settings } = await configSnapshot(tx);

  const flagViews: FlagView[] = FLAG_KEYS.filter((k) => schoolId === null || FEATURE_FLAGS[k].schoolOverridable).map((key) => {
    const def: FlagDef = FEATURE_FLAGS[key];
    const r = resolveFlag(flags, key, schoolId);
    const ownRow = flags.find((f) => f.key === key && f.schoolId === schoolId);
    return {
      key,
      labelFa: def.labelFa,
      descriptionFa: def.descriptionFa,
      upcoming: !!def.upcoming,
      schoolOverridable: def.schoolOverridable,
      enabled: r.enabled,
      source: r.source,
      own: ownRow ? ownRow.enabled : null,
      inherited: schoolId === null ? def.default : resolveFlag(flags, key, null).enabled,
    };
  });

  const settingViews: SettingView[] = SETTING_KEYS.filter((k) => schoolId === null || SETTINGS[k].schoolOverridable).map((key) => {
    const def: SettingDef = SETTINGS[key];
    const r = resolveSetting(settings, key, schoolId);
    const ownRow = settings.find((s) => s.key === key && s.schoolId === schoolId);
    const own = ownRow && settingSchema(key).safeParse(ownRow.value).success ? (ownRow.value as number | TimeRangeValue) : null;
    return {
      key,
      labelFa: def.labelFa,
      descriptionFa: def.descriptionFa,
      upcoming: !!def.upcoming,
      schoolOverridable: def.schoolOverridable,
      kind: def.kind,
      unitFa: def.kind === "int" ? def.unitFa : null,
      min: def.kind === "int" ? def.min : null,
      max: def.kind === "int" ? def.max : null,
      value: r.value,
      source: r.source,
      own,
      inherited: schoolId === null ? def.default : resolveSetting(settings, key, null).value,
    };
  });

  return { schoolId, levels, orgName: ctx.orgName, flags: flagViews, settings: settingViews };
}
