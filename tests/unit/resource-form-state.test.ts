// `formSessionReducer` — the state of the admin create/edit dialog (QA round 2, MAJOR: after saving hours 4→5 the
// reopened dialog still showed 4 and «ذخیره» wrote 4 back). The rule: field values are seeded from the row's
// CURRENT `initial` when the dialog opens; closing (cancel, Escape, overlay, a save) drops edits and errors.
import { describe, expect, it } from "vitest";
import type { FormField } from "@/lib/admin/defineResource";
import { CLOSED_SESSION, defaults, formSessionReducer, serialize, type FormSession } from "@/components/admin/resource-form-state";

const fields: FormField[] = [
  { name: "weeklyHours", labelFa: "ساعت در هفته", type: "number", numeric: true },
  { name: "status", labelFa: "وضعیت", type: "select", required: true, options: [{ value: "active", label: "فعال" }, { value: "closed", label: "پایان‌یافته" }] },
  { name: "mainTeacherStaffProfileId", labelFa: "دبیر اصلی", type: "select", optionsKey: "staff" },
  { name: "withTerms", labelFa: "دو نوبت", type: "toggle" },
];

const run = (events: Parameters<typeof formSessionReducer>[1][], from: FormSession = CLOSED_SESSION) => events.reduce(formSessionReducer, from);

describe("formSessionReducer", () => {
  it("opens with the row's values, and a re-open after a save reads the REFRESHED row, not the values it opened with", () => {
    const beforeSave = run([{ type: "open", fields, initial: { weeklyHours: 4, status: "active", mainTeacherStaffProfileId: null } }]);
    expect(beforeSave.open).toBe(true);
    expect(beforeSave.values).toEqual({ weeklyHours: 4, status: "active", mainTeacherStaffProfileId: null, withTerms: true });

    // The user types 5, saves: the dialog closes; the page refreshes and the row now says 5.
    const saved = run([{ type: "change", name: "weeklyHours", value: "5" }, { type: "close" }], beforeSave);
    expect(saved).toEqual(CLOSED_SESSION);

    const reopened = run([{ type: "open", fields, initial: { weeklyHours: 5, status: "active", mainTeacherStaffProfileId: null } }], saved);
    expect(reopened.values.weeklyHours).toBe(5);
    // A no-op «ذخیره» now serializes the saved value, so the database keeps 5.
    expect(serialize(fields[0], reopened.values.weeklyHours)).toBe(5);
  });

  it("«انصراف» discards typed input and errors: the next open starts from the row again", () => {
    const initial = { weeklyHours: 4, status: "active", mainTeacherStaffProfileId: null };
    const dirty = run([
      { type: "open", fields, initial },
      { type: "change", name: "weeklyHours", value: "99" },
      { type: "errors", errors: { weeklyHours: "ساعت هفتگی حداکثر ۴۰ است.", form: "خطای اعتبارسنجی" } },
    ]);
    expect(dirty.errors.weeklyHours).toBeTruthy();
    const cancelled = formSessionReducer(dirty, { type: "close" });
    expect(cancelled.open).toBe(false);
    expect(cancelled.errors).toEqual({});
    const again = formSessionReducer(cancelled, { type: "open", fields, initial });
    expect(again.values.weeklyHours).toBe(4);
    expect(again.errors).toEqual({});
  });

  it("change keeps the other fields; errors replace the previous set", () => {
    const s = run([
      { type: "open", fields, initial: { weeklyHours: 4, status: "active" } },
      { type: "change", name: "status", value: "closed" },
      { type: "errors", errors: { status: "x" } },
      { type: "errors", errors: { form: "y" } },
    ]);
    expect(s.values).toMatchObject({ weeklyHours: 4, status: "closed" });
    expect(s.errors).toEqual({ form: "y" });
  });
});

describe("defaults / serialize", () => {
  it("defaults: the row value wins; otherwise the empty value of the field type (first option for a static select, «withTerms» toggle on)", () => {
    expect(defaults(fields)).toEqual({ weeklyHours: "", status: "active", mainTeacherStaffProfileId: "", withTerms: true });
    expect(defaults(fields, { weeklyHours: 3, status: "closed", withTerms: false })).toEqual({ weeklyHours: 3, status: "closed", mainTeacherStaffProfileId: "", withTerms: false });
  });

  it("serialize: Persian digits become numbers, an empty number is null, an empty optional select is null and an empty required select is «»", () => {
    expect(serialize(fields[0], "۱۲")).toBe(12);
    expect(serialize(fields[0], "")).toBeNull();
    expect(serialize(fields[0], "abc")).toBe("abc");
    expect(serialize(fields[1], "")).toBe("");
    expect(serialize(fields[2], "")).toBeNull();
    expect(serialize(fields[3], true)).toBe(true);
    expect(serialize({ name: "name", labelFa: "نام", type: "text" }, "  ۱۰/۳ ")).toBe("۱۰/۳");
  });
});
