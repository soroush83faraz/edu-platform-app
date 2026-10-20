"use server";
// «تنظیمات» Server Actions: one feature switch or one setting at one level (the organization, or a school). Through
// defineAction (session → must-change → strict Zod → `config.settings.manage` at the ORGANIZATION for the
// organization's level, at the school for a school's → tenant transaction); the service re-checks the scope, the
// overridability of the key and the school, and audits the change in the same transaction. Fields are mapped one by
// one — nothing from the client is spread into a query.
import { defineAction } from "@/lib/actions";
import { SetFlagInput, SetSettingInput } from "./dto";
import { CONFIG_PERMISSION, setFlag, setSetting } from "./service";

const levelScope = (input: { schoolId: string | null }) => (input.schoolId ? { scopeType: "school" as const, id: input.schoolId } : undefined);

export const setFlagAction = defineAction({ schema: SetFlagInput, permission: CONFIG_PERMISSION, scope: levelScope }, (tx, input, ctx) =>
  setFlag(tx, ctx, { key: input.key, schoolId: input.schoolId, value: input.value }),
);

export const setSettingAction = defineAction({ schema: SetSettingInput, permission: CONFIG_PERMISSION, scope: levelScope }, (tx, input, ctx) =>
  setSetting(tx, ctx, { key: input.key, schoolId: input.schoolId, mode: input.mode, value: input.value, start: input.start, end: input.end }),
);
