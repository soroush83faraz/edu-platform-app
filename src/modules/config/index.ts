// Public surface of the config module: feature switches and settings (registry, readers).
export { FEATURE_FLAGS, FLAG_KEYS, type FlagKey } from "./flags";
export { SETTINGS, SETTING_KEYS, type SettingKey, type SettingValue } from "./settings";
export { flagEnabled, settingOf } from "./service";
