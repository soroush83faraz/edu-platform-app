import { describe, expect, it } from "vitest";
import {
  DUMMY_HASH,
  PASSWORD_POLICY_MESSAGES,
  generateInitialPassword,
  hashPassword,
  isWeakDigitString,
  validateNewPassword,
  verifyPassword,
} from "@/modules/iam/password";

describe("generateInitialPassword", () => {
  it("is 8 ASCII digits, never starts with 0, never a repeat/sequence", () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInitialPassword();
      expect(p).toMatch(/^[1-9]\d{7}$/);
      expect(isWeakDigitString(p)).toBe(false);
    }
  });
  it("is not constant", () => {
    const set = new Set(Array.from({ length: 20 }, () => generateInitialPassword()));
    expect(set.size).toBeGreaterThan(1);
  });
});

describe("isWeakDigitString", () => {
  it.each(["11111111", "12345678", "87654321", "23456789", "99998765", "45555567"])("rejects %s", (s) => {
    expect(isWeakDigitString(s)).toBe(true);
  });
  it.each(["13579246", "48213765", "10203040", "12312312"])("accepts %s", (s) => {
    expect(isWeakDigitString(s)).toBe(false);
  });
});

describe("validateNewPassword", () => {
  it("enforces the minimum length with a Persian message", () => {
    expect(validateNewPassword("abc1234")).toEqual({ ok: false, message: PASSWORD_POLICY_MESSAGES.tooShort });
  });
  it("rejects the identifier / phone in every common spelling (incl. Persian digits)", () => {
    const ctx = { identifier: "+989123000001", phoneE164: "+989123000001" };
    expect(validateNewPassword("+989123000001", ctx)).toEqual({ ok: false, message: PASSWORD_POLICY_MESSAGES.equalsIdentifier });
    expect(validateNewPassword("09123000001", ctx)).toEqual({ ok: false, message: PASSWORD_POLICY_MESSAGES.equalsIdentifier });
    expect(validateNewPassword("9123000001", ctx)).toEqual({ ok: false, message: PASSWORD_POLICY_MESSAGES.equalsIdentifier });
    expect(validateNewPassword("۰۹۱۲۳۰۰۰۰۰۱", ctx)).toEqual({ ok: false, message: PASSWORD_POLICY_MESSAGES.equalsIdentifier });
    expect(validateNewPassword("Danesh-Admin", { identifier: "danesh-admin" })).toEqual({
      ok: false,
      message: PASSWORD_POLICY_MESSAGES.equalsIdentifier,
    });
  });
  it("rejects common and trivially weak passwords", () => {
    expect(validateNewPassword("12345678")).toEqual({ ok: false, message: PASSWORD_POLICY_MESSAGES.common });
    expect(validateNewPassword("password1")).toEqual({ ok: false, message: PASSWORD_POLICY_MESSAGES.common });
    expect(validateNewPassword("22222222")).toEqual({ ok: false, message: PASSWORD_POLICY_MESSAGES.weak });
    expect(validateNewPassword("aaaaaaaa")).toEqual({ ok: false, message: PASSWORD_POLICY_MESSAGES.weak });
  });
  it("accepts a reasonable password (also a strong all-digit one)", () => {
    expect(validateNewPassword("Kh0rshid!1405")).toEqual({ ok: true });
    expect(validateNewPassword("48213765", { identifier: "+989123000001" })).toEqual({ ok: true });
  });
});

describe("argon2id", () => {
  it("hash → verify round trip; wrong password fails; DUMMY_HASH verifies nothing", async () => {
    const h = await hashPassword("s3cret-پسورد");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).toContain("m=19456,t=2,p=1");
    expect(await verifyPassword(h, "s3cret-پسورد")).toBe(true);
    expect(await verifyPassword(h, "s3cret-پسورد!")).toBe(false);
    expect(DUMMY_HASH.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(DUMMY_HASH, "anything")).toBe(false);
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });
});
