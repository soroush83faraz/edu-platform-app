// Request context = "who is calling, in which organization, with which role assignments". Resolved from the
// session cookie ONCE per request (React `cache()`), from the database — never from proxy.ts headers or client
// input. This is the security boundary every action and every (app) page builds on.
import { cache } from "react";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { withTenant, withoutTenant } from "@/db/client";
import { unauthenticated } from "@/lib/errors";
import { NEXT_PATH_HEADER } from "@/lib/next-path-header";
import { getClientIp, getUserAgent } from "@/lib/request";
import type { Assignment } from "@/modules/iam/can";
import { safeNextPath } from "@/modules/iam/next-path";
import { findMemberContext, listValidAssignments } from "@/modules/iam/repo";
import { findLiveSessionContext, readSessionToken, touchSession } from "@/modules/iam/session";

export interface Ctx {
  requestId: string;
  userId: string;
  sessionId: string;
  orgId: string;
  personId: string;
  mustChangePassword: boolean;
  assignments: Assignment[];
  /** Display facts of the caller — safe to render, never used for authorization. */
  firstName: string;
  lastName: string;
  orgName: string;
  schoolName: string | null;
  /** Request facts for the audit trail (src/lib/audit.ts); never used for authorization. */
  ip: string;
  userAgent: string | null;
  /** Session bookkeeping for defineAction (cookie re-issue after a sliding extension). */
  session: { isPublicDevice: boolean; expiresAt: Date; extended: boolean };
}

/** `x-request-id` set by src/proxy.ts; a fresh UUID when the request bypassed the proxy (tests, internal). */
export const getRequestId = cache(async (): Promise<string> => {
  const h = await headers();
  const id = h.get("x-request-id");
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : randomUUID();
});

/**
 * Where a PAGE sends a visitor whose cookie resolved to no context (dead, revoked, forged): `/login`, carrying the
 * page the proxy recorded in `x-next-path` as `?next=` so the deep link survives the re-login — the same rule as
 * the proxy's cookie-less redirect (docs/auth.md). The header only ever comes from src/proxy.ts (it overwrites or
 * removes whatever the client sent) and is re-validated by `safeNextPath` here; it is a convenience, never an
 * authorization input. Without the proxy (tests, internal renders) the result is plain `/login`.
 */
export async function loginRedirectHref(): Promise<string> {
  const h = await headers();
  const next = safeNextPath(h.get(NEXT_PATH_HEADER));
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

/**
 * cookie → (global) live session + active account → (tenant = session.current_org_id) active membership →
 * person, organization/school names, valid role assignments with permissions. Null on ANY gap.
 */
export const getRequestContext = cache(async (): Promise<Ctx | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  const requestId = await getRequestId();

  // Two transactions, four statements when nothing is written (it runs on every request): the global half
  // (session ⋈ account ⋈ organization name, then the throttled last-seen touch), then the tenant half
  // (membership ⋈ person + primary school, then the valid assignments).
  const base = await withoutTenant(async (tx) => {
    const found = await findLiveSessionContext(tx, token);
    if (!found) return null;
    const { session, account, orgName } = found;
    const orgId = session.currentOrgId;
    if (!orgId || account.status !== "active") return null;
    const touched = await touchSession(tx, session);
    if (!orgName) return null;
    return { session, account, touched, orgName, orgId };
  });
  if (!base) return null;

  const tenant = await withTenant({ orgId: base.orgId }, async (tx) => {
    const member = await findMemberContext(tx, base.account.id);
    if (!member) return null;
    const assignments = await listValidAssignments(tx, member.personId);
    return { personId: member.personId, name: { firstName: member.firstName, lastName: member.lastName }, schoolName: member.schoolName, assignments };
  });
  if (!tenant) return null;

  return {
    requestId,
    ip: await getClientIp(),
    userAgent: await getUserAgent(),
    userId: base.account.id,
    sessionId: base.session.id,
    orgId: base.orgId,
    personId: tenant.personId,
    mustChangePassword: base.account.mustChangePassword,
    assignments: tenant.assignments,
    firstName: tenant.name.firstName,
    lastName: tenant.name.lastName,
    orgName: base.orgName,
    schoolName: tenant.schoolName,
    session: { isPublicDevice: base.session.isPublicDevice, expiresAt: base.touched.expiresAt, extended: base.touched.extended },
  };
});

/** Throws AppError('UNAUTHENTICATED'); pages catch it and redirect to /login, actions turn it into a Result. */
export async function requireContext(): Promise<Ctx> {
  const ctx = await getRequestContext();
  if (!ctx) throw unauthenticated();
  return ctx;
}
