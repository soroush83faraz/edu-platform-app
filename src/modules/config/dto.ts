// config/dto — the inputs of the «تنظیمات» actions. `.strict()`; the organization comes from the session, the school
// is a choice the service re-checks against the caller's scope.
import { z } from "zod";
import { FLAG_KEYS } from "./flags";
import { SETTING_KEYS } from "./settings";

/** `null` = the organization level. */
const SchoolLevel = z.uuid().nullable();

export const SetFlagInput = z
  .object({
    key: z.enum(FLAG_KEYS),
    schoolId: SchoolLevel,
    /** «روشن» / «خاموش» at this level, or «پیروی» — remove this level's value. */
    value: z.enum(["on", "off", "inherit"]),
  })
  .strict();
export type SetFlagInput = z.infer<typeof SetFlagInput>;

export const SetSettingInput = z
  .object({
    key: z.enum(SETTING_KEYS),
    schoolId: SchoolLevel,
    /** `set` the value typed here, or `inherit` — remove this level's value. */
    mode: z.enum(["set", "inherit"]),
    value: z.string().max(8).optional(),
    start: z.string().max(8).optional(),
    end: z.string().max(8).optional(),
  })
  .strict();
export type SetSettingInput = z.infer<typeof SetSettingInput>;

export const SettingsPageInput = z.object({ schoolId: SchoolLevel }).strict();
