// «ورود آزمایشی» — WHO the demo login may sign in as, as a pure rule over database facts (unit-tested; the action
// feeds it rows read in the same transaction that creates the session). The panel's list applies the same filters
// in SQL, but this rule is the authority: a hand-made request for any other account id is refused here.
//
//   1. the account exists, is `active` (never `disabled` — a removed person — nor admin-`locked`), has no live soft
//      lock (`locked_until` in the future) and no pending forced password change (the demo never skips
//      /change-password, and it never sets a password);
//   2. EVERY membership of the account, whatever its status, is in an allow-listed organization — an account that
//      also belongs to a real school (or once did) is never reachable, so «مدیر سازمان» of a non-demo organization
//      can never be signed in to;
//   3. the session lands where a password login would land: the active membership of an active organization, the
//      default organization first, then the oldest (`listActiveMembershipsForAccount`). The person behind it must
//      still be active — checked by the caller inside the tenant transaction (`person` is a tenant table).

export interface DemoAccountFacts {
  id: string;
  status: string;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
}

export interface DemoMembershipFacts {
  organizationId: string;
  orgSlug: string;
  orgStatus: string;
  status: string;
  personId: string;
  isDefaultOrg: boolean;
  joinedAt: Date | null;
}

export type DemoRefusal = "no_account" | "inactive" | "locked" | "must_change_password" | "no_membership" | "outside_demo";

export type DemoTarget = { ok: true; organizationId: string; personId: string } | { ok: false; reason: DemoRefusal };

export function demoTarget(
  account: DemoAccountFacts | null,
  memberships: readonly DemoMembershipFacts[],
  allowedSlugs: readonly string[],
  now: Date,
): DemoTarget {
  if (!account) return { ok: false, reason: "no_account" };
  if (account.status !== "active") return { ok: false, reason: "inactive" };
  if (account.lockedUntil !== null && account.lockedUntil.getTime() > now.getTime()) return { ok: false, reason: "locked" };
  if (account.mustChangePassword) return { ok: false, reason: "must_change_password" };
  if (memberships.length === 0) return { ok: false, reason: "no_membership" };
  const allowed = new Set(allowedSlugs);
  if (memberships.some((m) => !allowed.has(m.orgSlug))) return { ok: false, reason: "outside_demo" };
  const live = memberships
    .filter((m) => m.status === "active" && m.orgStatus === "active")
    .sort((a, b) => Number(b.isDefaultOrg) - Number(a.isDefaultOrg) || joinedMs(a) - joinedMs(b));
  if (live.length === 0) return { ok: false, reason: "no_membership" };
  return { ok: true, organizationId: live[0].organizationId, personId: live[0].personId };
}

/** Oldest first; a membership without `joined_at` sorts last. */
function joinedMs(m: DemoMembershipFacts): number {
  return m.joinedAt ? m.joinedAt.getTime() : Number.MAX_SAFE_INTEGER;
}
