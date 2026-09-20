// AES-256-GCM for `iam.auth_identity.initial_password_enc`. The ONLY thing ever encrypted with this key is the
// random initial password of a freshly created / reset account, kept so the admin can print the credentials sheet
// of a class later (a nightly job nulls it after 72 h — week 1). Login never reads it (argon2 hash only).
//
// Format: `v1:<iv b64url>:<tag b64url>:<ciphertext b64url>` — 12-byte IV from crypto.randomBytes, 16-byte tag.
// The key is read lazily from `process.env.INITIAL_PASSWORD_KEY` (validated by src/lib/env.ts for the app), not
// through env.ts, so scripts (seed, import) that load `.env` at runtime can import this module first.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.INITIAL_PASSWORD_KEY ?? "";
  if (!KEY_HEX_RE.test(hex)) {
    throw new Error("INITIAL_PASSWORD_KEY must be 32 bytes as 64 hex characters (see .env.example)");
  }
  cachedKey = Buffer.from(hex, "hex");
  return cachedKey;
}

/** For tests only: forget the cached key after `process.env.INITIAL_PASSWORD_KEY` changed. */
export function resetInitialPasswordKeyCache(): void {
  cachedKey = null;
}

export function encryptInitialPassword(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

/** Null when the value is missing, malformed, or was encrypted with another key (tag mismatch) — never throws. */
export function decryptInitialPassword(enc: string | null | undefined): string | null {
  if (!enc) return null;
  const parts = enc.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ct = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
