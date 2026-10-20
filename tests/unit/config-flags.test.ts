// The «تنظیمات» registries (src/modules/config/flags.ts, settings.ts): Persian labels, defaults, precedence school >
// organization > default, and the input parsing of the settings page.
import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS, FLAG_KEYS, type FlagRow, resolveFlag } from "@/modules/config/flags";
import { SETTINGS, SETTING_KEYS, type SettingRow, parseSettingInput, resolveSetting, settingSchema } from "@/modules/config/settings";

const S1 = "0199a000-0001-7000-8000-000000000001";
const S2 = "0199a000-0001-7000-8000-000000000002";
const LATIN = /[A-Za-z]/;

describe("feature switches", () => {
  it("every key has a Persian label and description, no Latin, and the upcoming ones default to off", () => {
    expect(FLAG_KEYS).toEqual(["messaging", "grades_monthly", "grade_appeals", "leave_requests", "class_register", "deadline_reminders", "request_center"]);
    for (const k of FLAG_KEYS) {
      const d = FEATURE_FLAGS[k];
      expect(d.labelFa, k).not.toMatch(LATIN);
      expect(d.descriptionFa, k).not.toMatch(LATIN);
      if ("upcoming" in d && d.upcoming) expect(d.default, k).toBe(false);
    }
  });

  it("school (overridable keys only) > organization > default", () => {
    const rows: FlagRow[] = [
      { key: "messaging", schoolId: null, enabled: true },
      { key: "messaging", schoolId: S1, enabled: false },
      { key: "request_center", schoolId: S1, enabled: true },
      { key: "not_a_key", schoolId: null, enabled: true },
    ];
    expect(resolveFlag(rows, "messaging")).toEqual({ enabled: true, source: "organization" });
    expect(resolveFlag(rows, "messaging", S1)).toEqual({ enabled: false, source: "school" });
    expect(resolveFlag(rows, "messaging", S2)).toEqual({ enabled: true, source: "organization" });
    expect(resolveFlag(rows, "grade_appeals", S1)).toEqual({ enabled: false, source: "default" });
    expect(resolveFlag(rows, "request_center", S1)).toEqual({ enabled: false, source: "default" }); // not school-overridable
  });
});

describe("settings", () => {
  it("every key has a Persian label, a default that fits its own schema, and the owner's appeal window of 7 days", () => {
    for (const k of SETTING_KEYS) {
      expect(SETTINGS[k].labelFa, k).not.toMatch(LATIN);
      expect(settingSchema(k).safeParse(SETTINGS[k].default).success, k).toBe(true);
    }
    expect(SETTINGS["grades.appeal_window_days"].default).toBe(7);
    expect(SETTINGS["grades.appeal_response_days"].default).toBe(2);
    expect(SETTINGS["notif.quiet_hours"].default).toEqual({ start: "22:00", end: "07:00" });
    expect(SETTINGS["reminders.deadline_lead_hours"].default).toBe(24);
  });

  it("school > organization > default, skipping a stored value that does not fit", () => {
    const rows: SettingRow[] = [
      { key: "grades.appeal_window_days", schoolId: null, value: 10 },
      { key: "grades.appeal_window_days", schoolId: S1, value: 99 }, // out of range → skipped
      { key: "grades.appeal_window_days", schoolId: S2, value: 3 },
    ];
    expect(resolveSetting(rows, "grades.appeal_window_days")).toEqual({ value: 10, source: "organization" });
    expect(resolveSetting(rows, "grades.appeal_window_days", S1)).toEqual({ value: 10, source: "organization" });
    expect(resolveSetting(rows, "grades.appeal_window_days", S2)).toEqual({ value: 3, source: "school" });
    expect(resolveSetting([], "notif.quiet_hours", S1)).toEqual({ value: { start: "22:00", end: "07:00" }, source: "default" });
  });

  it("parses the page's fields: Persian digits, ranges, times", () => {
    expect(parseSettingInput("grades.appeal_window_days", { value: "۱۴" })).toBe(14);
    expect(parseSettingInput("grades.appeal_window_days", { value: " 7 " })).toBe(7);
    expect(parseSettingInput("grades.appeal_window_days", { value: "31" })).toBeNull();
    expect(parseSettingInput("grades.appeal_window_days", { value: "0" })).toBeNull();
    expect(parseSettingInput("grades.appeal_window_days", { value: "7.5" })).toBeNull();
    expect(parseSettingInput("grades.appeal_window_days", {})).toBeNull();
    expect(parseSettingInput("notif.quiet_hours", { start: "۲۲:۰۰", end: "07:00" })).toEqual({ start: "22:00", end: "07:00" });
    expect(parseSettingInput("notif.quiet_hours", { start: "7:00", end: "07:00" })).toBeNull();
    expect(parseSettingInput("notif.quiet_hours", { start: "22:00" })).toBeNull();
  });
});
