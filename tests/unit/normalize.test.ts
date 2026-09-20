import { describe, expect, it } from "vitest";
import { normalizeFa, normalizePhoneIR, toAsciiDigits } from "@/lib/normalize";

describe("toAsciiDigits", () => {
  it("converts Persian digits", () => {
    expect(toAsciiDigits("۰۹۱۲۳۴۵۶۷۸۹")).toBe("09123456789");
  });
  it("converts Arabic-Indic digits", () => {
    expect(toAsciiDigits("٠٩١٢٣٤٥٦٧٨٩")).toBe("09123456789");
  });
  it("leaves other characters intact", () => {
    expect(toAsciiDigits("کلاس ۱۰/۲ - a1")).toBe("کلاس 10/2 - a1");
  });
});

describe("normalizePhoneIR", () => {
  it.each([
    ["09123456789", "+989123456789"],
    ["9123456789", "+989123456789"],
    ["+989123456789", "+989123456789"],
    ["989123456789", "+989123456789"],
    ["00989123456789", "+989123456789"],
    ["۰۹۱۲۳۴۵۶۷۸۹", "+989123456789"],
    ["0912 345 67 89", "+989123456789"],
    ["0912-345-6789", "+989123456789"],
    [" +98 (912) 345-6789 ", "+989123456789"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhoneIR(input)).toBe(expected);
  });

  it.each(["", "0912345678", "091234567890", "02112345678", "+1 555 123 4567", "abc", "0812345678"])(
    "rejects %s",
    (input) => {
      expect(normalizePhoneIR(input)).toBeNull();
    },
  );
});

describe("normalizeFa", () => {
  it("maps Arabic letters to Persian", () => {
    expect(normalizeFa("علي كريمي مدرسة")).toBe("علی کریمی مدرسه");
  });
  it("collapses whitespace and trims", () => {
    expect(normalizeFa("  سارا \t  احمدی \n ")).toBe("سارا احمدی");
  });
  it("collapses repeated ZWNJ", () => {
    expect(normalizeFa("می\u200C\u200Cرود")).toBe("می\u200Cرود");
  });
});
