// Password hashing (argon2id, PHC strings in iam.auth_identity.secret_hash), the constant-time dummy verify used
// when an account does not exist, initial-password generation and the new-password policy.
import { hash, hashSync, verify, type Algorithm } from "@node-rs/argon2";
import { randomBytes, randomInt } from "node:crypto";
import { normalizePhoneIR, toAsciiDigits } from "@/lib/normalize";

/** OWASP 2024 baseline for argon2id: 19 MiB, 2 passes, 1 lane. Changing these changes nothing for old hashes. */
// `Algorithm` is an ambient const enum (not usable under isolatedModules); 2 === Algorithm.Argon2id.
const ARGON2ID = 2 as Algorithm;
const ARGON2_PARAMS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS);
}

/** Never throws: a malformed stored hash counts as a failed verification. */
export async function verifyPassword(phcHash: string, password: string): Promise<boolean> {
  try {
    return await verify(phcHash, password);
  } catch {
    return false;
  }
}

/**
 * Hash of a random string generated once per process. Login runs `verifyPassword(DUMMY_HASH, input)` when the
 * account does not exist / is not active, so a wrong identifier costs the same time as a wrong password.
 */
export const DUMMY_HASH: string = hashSync(randomBytes(32).toString("base64url"), ARGON2_PARAMS);

/** All digits equal, or a run of 4+ identical digits, or a monotonic ±1 staircase over the whole string. */
export function isWeakDigitString(digits: string): boolean {
  if (/^(\d)\1+$/.test(digits)) return true;
  if (/(\d)\1{3}/.test(digits)) return true;
  let asc = true;
  let desc = true;
  for (let i = 1; i < digits.length; i++) {
    const d = digits.charCodeAt(i) - digits.charCodeAt(i - 1);
    if (d !== 1) asc = false;
    if (d !== -1) desc = false;
  }
  return asc || desc;
}

/** 8 digits, first digit 1–9, from crypto.randomInt; re-rolled while it looks like a sequence or a repeat. */
export function generateInitialPassword(): string {
  for (;;) {
    let s = String(randomInt(1, 10));
    for (let i = 1; i < 8; i++) s += String(randomInt(0, 10));
    if (!isWeakDigitString(s)) return s;
  }
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Small deny-list; a real breached-password check is out of phase 1. Compared after lower-casing + ASCII digits. */
const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "87654321",
  "11111111",
  "00000000",
  "password",
  "password1",
  "qwerty123",
  "qwertyuiop",
  "iloveyou",
  "abcd1234",
  "1q2w3e4r",
  "admin123",
  "welcome1",
  "letmein1",
]);

export type PolicyResult = { ok: true } | { ok: false; message: string };

export interface PolicyContext {
  /** `user_account.login_identifier` (normalized phone or username). */
  identifier?: string | null;
  phoneE164?: string | null;
}

export const PASSWORD_POLICY_MESSAGES = {
  tooShort: `رمز باید دست‌کم ${PASSWORD_MIN_LENGTH} نویسه باشد.`,
  tooLong: `رمز نمی‌تواند بیش از ${PASSWORD_MAX_LENGTH} نویسه باشد.`,
  equalsIdentifier: "رمز نمی‌تواند همان شمارهٴ موبایل یا نام‌کاربری شما باشد.",
  common: "این رمز بسیار رایج است؛ رمز دیگری انتخاب کنید.",
  weak: "رمز نباید تکراری یا ترتیبی باشد (مثل ۱۱۱۱۱۱۱۱ یا ۱۲۳۴۵۶۷۸).",
  mismatch: "تکرار رمز با رمز جدید یکی نیست.",
} as const;

/** Policy for a NEW password. Pure; the caller compares `newPassword === confirm` with `PASSWORD_POLICY_MESSAGES.mismatch`. */
export function validateNewPassword(newPassword: string, ctx: PolicyContext = {}): PolicyResult {
  if (newPassword.length < PASSWORD_MIN_LENGTH) return { ok: false, message: PASSWORD_POLICY_MESSAGES.tooShort };
  if (newPassword.length > PASSWORD_MAX_LENGTH) return { ok: false, message: PASSWORD_POLICY_MESSAGES.tooLong };

  const ascii = toAsciiDigits(newPassword).toLowerCase();
  const asPhone = normalizePhoneIR(ascii);
  const identifiers = new Set<string>();
  for (const v of [ctx.identifier, ctx.phoneE164]) {
    if (!v) continue;
    identifiers.add(v.toLowerCase());
    if (v.startsWith("+98")) {
      identifiers.add(v.slice(3)); // 9121234567
      identifiers.add(`0${v.slice(3)}`); // 09121234567
    }
  }
  if (identifiers.has(ascii) || (asPhone !== null && identifiers.has(asPhone))) {
    return { ok: false, message: PASSWORD_POLICY_MESSAGES.equalsIdentifier };
  }
  if (COMMON_PASSWORDS.has(ascii)) return { ok: false, message: PASSWORD_POLICY_MESSAGES.common };
  if (/^\d+$/.test(ascii) && isWeakDigitString(ascii)) return { ok: false, message: PASSWORD_POLICY_MESSAGES.weak };
  if (/^(.)\1+$/u.test(newPassword)) return { ok: false, message: PASSWORD_POLICY_MESSAGES.weak };
  return { ok: true };
}
