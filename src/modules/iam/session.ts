// Opaque server-side sessions (iam.user_session). The browser holds a random token; the database holds only
// sha256(token). Every function takes `tx` (a `withoutTenant` transaction — user_session is a global table);
// the cookie helpers use Next's async `cookies()` and may only WRITE inside a Server Action / Route Handler.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import type { Tx } from "@/lib/actions";
import {
  LAST_SEEN_INTERVAL_MS,
  PUBLIC_DEVICE_TTL_MS,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_SECURE,
  SESSION_SLIDING_THRESHOLD_MS,
  SESSION_TTL_MS,
} from "@/lib/session-cookie";
import { userSession } from "./schema";

export interface SessionRow {
  id: string;
  userAccountId: string;
  currentOrgId: string | null;
  isPublicDevice: boolean;
  expiresAt: Date;
  lastSeenAt: Date | null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateSessionInput {
  userAccountId: string;
  currentOrgId: string;
  isPublicDevice: boolean;
  ip: string | null;
  userAgent: string | null;
}

export async function createSession(tx: Tx, input: CreateSessionInput, now = new Date()): Promise<{ token: string; session: SessionRow }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + (input.isPublicDevice ? PUBLIC_DEVICE_TTL_MS : SESSION_TTL_MS));
  const rows = await tx
    .insert(userSession)
    .values({
      userAccountId: input.userAccountId,
      tokenHash: hashToken(token),
      currentOrgId: input.currentOrgId,
      isPublicDevice: input.isPublicDevice,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      expiresAt,
      lastSeenAt: now,
    })
    .returning({
      id: userSession.id,
      userAccountId: userSession.userAccountId,
      currentOrgId: userSession.currentOrgId,
      isPublicDevice: userSession.isPublicDevice,
      expiresAt: userSession.expiresAt,
      lastSeenAt: userSession.lastSeenAt,
    });
  return { token, session: rows[0] };
}

/** Not revoked and not expired (expiry is compared in the database, one clock). */
export async function findLiveSessionByToken(tx: Tx, token: string): Promise<SessionRow | null> {
  const rows = await tx
    .select({
      id: userSession.id,
      userAccountId: userSession.userAccountId,
      currentOrgId: userSession.currentOrgId,
      isPublicDevice: userSession.isPublicDevice,
      expiresAt: userSession.expiresAt,
      lastSeenAt: userSession.lastSeenAt,
    })
    .from(userSession)
    .where(and(eq(userSession.tokenHash, hashToken(token)), isNull(userSession.revokedAt), gt(userSession.expiresAt, sql`now()`)))
    .limit(1);
  return rows[0] ?? null;
}

export interface TouchResult {
  expiresAt: Date;
  /** The expiry moved: the cookie must be re-issued (only possible inside a Server Action). */
  extended: boolean;
}

/**
 * `last_seen_at` at most once per LAST_SEEN_INTERVAL_MS; trusted-device sessions slide forward to a fresh
 * 30 days once fewer than 7 remain. Public-device sessions never extend.
 */
export async function touchSession(tx: Tx, session: SessionRow, now = new Date()): Promise<TouchResult> {
  const seenStale = session.lastSeenAt === null || now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_INTERVAL_MS;
  const extend = !session.isPublicDevice && session.expiresAt.getTime() - now.getTime() < SESSION_SLIDING_THRESHOLD_MS;
  if (!seenStale && !extend) return { expiresAt: session.expiresAt, extended: false };
  const expiresAt = extend ? new Date(now.getTime() + SESSION_TTL_MS) : session.expiresAt;
  await tx
    .update(userSession)
    .set({ lastSeenAt: now, ...(extend ? { expiresAt } : {}) })
    .where(eq(userSession.id, session.id));
  return { expiresAt, extended: extend };
}

export async function revokeSession(tx: Tx, sessionId: string): Promise<void> {
  await tx
    .update(userSession)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(userSession.id, sessionId), isNull(userSession.revokedAt)));
}

/** «خروج از همهٴ دستگاه‌ها» / after a password change (`exceptSessionId` keeps the current one). */
export async function revokeAllForUser(tx: Tx, userAccountId: string, exceptSessionId?: string): Promise<number> {
  const rows = await tx
    .update(userSession)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(userSession.userAccountId, userAccountId),
        isNull(userSession.revokedAt),
        exceptSessionId ? sql`${userSession.id} <> ${exceptSessionId}` : undefined,
      ),
    )
    .returning({ id: userSession.id });
  return rows.length;
}

// ---- cookie helpers (Next `cookies()` is async) ----

export interface SessionCookieOptions {
  isPublicDevice: boolean;
  expiresAt: Date;
}

/** HttpOnly, SameSite=Lax, Path=/, no Domain; Secure + `__Host-` in production. Public device → no Max-Age. */
export async function setSessionCookie(token: string, opts: SessionCookieOptions): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: SESSION_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    ...(opts.isPublicDevice ? {} : { expires: opts.expiresAt }),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", { httpOnly: true, secure: SESSION_COOKIE_SECURE, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  const v = store.get(SESSION_COOKIE_NAME)?.value;
  return v && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null;
}
