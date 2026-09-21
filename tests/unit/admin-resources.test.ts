// Pure helpers of the admin forms: `flatten` (server field errors → per-field + form-level line; errors on fields the
// form does not render are never silent — the QA-round-1 blocker) and the ezafe helpers. The schema ⊆ edit-form
// structural check lives in tests/int/admin-resource-form.test.ts (the resource module pulls the DB client).
import { describe, expect, it } from "vitest";
import { indefiniteFa, newLabelFa } from "@/lib/admin/defineResource";
import { flatten } from "@/lib/form-errors";

describe("flatten (admin forms)", () => {
  it("errors on rendered fields stay per field; errors on hidden fields become one form-level line", () => {
    expect(flatten({ name: ["نام را وارد کنید."] }, "x", ["name"])).toEqual({ name: "نام را وارد کنید." });
    expect(flatten({ subjectId: ["درس را انتخاب کنید."], termId: ["نوبت را انتخاب کنید."] }, "x", ["status"])).toEqual({
      form: "خطای اعتبارسنجی: درس را انتخاب کنید. نوبت را انتخاب کنید.",
    });
    expect(flatten({ status: ["وضعیت را انتخاب کنید."], termId: ["نوبت را انتخاب کنید."] }, "x", ["status"])).toEqual({ status: "وضعیت را انتخاب کنید.", form: "خطای اعتبارسنجی: نوبت را انتخاب کنید." });
    expect(flatten(undefined, "پیام کلی")).toEqual({ form: "پیام کلی" });
    expect(flatten({ "a.0": ["x"] }, "m")).toEqual({ a: "x" });
  });
});

describe("ezafe helpers", () => {
  it("«مدرسهٴ جدید» / «کلاس جدید», «مدرسه‌ای» / «کلاسی»", () => {
    expect(newLabelFa("مدرسه")).toBe("مدرسهٴ جدید");
    expect(newLabelFa("کلاس")).toBe("کلاس جدید");
    expect(indefiniteFa("مدرسه")).toBe("مدرسه‌ای");
    expect(indefiniteFa("کلاس")).toBe("کلاسی");
  });
});
