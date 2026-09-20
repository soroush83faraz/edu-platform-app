import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptInitialPassword, encryptInitialPassword, resetInitialPasswordKeyCache } from "@/lib/crypto";

const KEY_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("initial password encryption (AES-256-GCM)", () => {
  const prev = process.env.INITIAL_PASSWORD_KEY;
  beforeAll(() => {
    process.env.INITIAL_PASSWORD_KEY = KEY_A;
    resetInitialPasswordKeyCache();
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.INITIAL_PASSWORD_KEY;
    else process.env.INITIAL_PASSWORD_KEY = prev;
    resetInitialPasswordKeyCache();
  });

  it("round-trips and never repeats the ciphertext (random IV)", () => {
    const a = encryptInitialPassword("48213956");
    const b = encryptInitialPassword("48213956");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(decryptInitialPassword(a)).toBe("48213956");
    expect(decryptInitialPassword(b)).toBe("48213956");
  });

  it("returns null for null / garbage / a tampered tag / another key", () => {
    expect(decryptInitialPassword(null)).toBeNull();
    expect(decryptInitialPassword("")).toBeNull();
    expect(decryptInitialPassword("not:an:enc")).toBeNull();
    const enc = encryptInitialPassword("12345678");
    const parts = enc.split(":");
    parts[2] = parts[2].replace(/^./, (c) => (c === "A" ? "B" : "A"));
    expect(decryptInitialPassword(parts.join(":"))).toBeNull();

    process.env.INITIAL_PASSWORD_KEY = KEY_B;
    resetInitialPasswordKeyCache();
    expect(decryptInitialPassword(enc)).toBeNull();
    process.env.INITIAL_PASSWORD_KEY = KEY_A;
    resetInitialPasswordKeyCache();
    expect(decryptInitialPassword(enc)).toBe("12345678");
  });

  it("rejects a missing or malformed key with a clear error", () => {
    process.env.INITIAL_PASSWORD_KEY = "short";
    resetInitialPasswordKeyCache();
    expect(() => encryptInitialPassword("x")).toThrow(/INITIAL_PASSWORD_KEY/);
    process.env.INITIAL_PASSWORD_KEY = KEY_A;
    resetInitialPasswordKeyCache();
  });
});
