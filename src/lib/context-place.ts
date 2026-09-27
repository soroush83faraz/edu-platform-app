// «Where am I?» — the one rule for the name that stands for the viewer's context in the shell's headers, the Home
// greeting card and the «حساب من» profile card (owner, 2026-09-27: «چرا بالا نوشته علامه طباطبایی؟ مدیر سازمان
// بالاتر از مدرسه است»). The ORGANIZATION admin's context is the organization, never a school or a branch — even when
// the organization has only one school, and even when they also teach (their teaching pages keep the class and
// school details; the header does not). An admin whose scope holds several schools is introduced by the
// organization too (owner, QA round 3). Everyone else — a principal, a vice principal, a teacher, a student — keeps
// their school.
import { ROLE_LABELS } from "@/components/brand/roles";
import { isOrganizationAdmin, type Assignment } from "@/modules/iam/can";

/** What the rule reads from the cached shell context (`getShellContext`); every field optional for a failed read. */
export interface PlaceShell {
  orgScoped?: boolean;
  schoolName?: string | null;
  schools?: readonly unknown[];
}

export interface PlaceFacts {
  orgName: string;
  /** The session's primary school (`ctx.schoolName`) — the fallback when the shell context has no school. */
  schoolName: string | null;
  assignments: readonly Assignment[];
}

/** The viewer's context is the whole organization: the shell says so, or (no query needed) the session does. */
export function isOrgContext(shell: PlaceShell, facts: Pick<PlaceFacts, "assignments">): boolean {
  return shell.orgScoped === true || isOrganizationAdmin(facts.assignments);
}

/** The name that stands for the viewer's context: the organization for an org admin or a multi-school scope, else the school. */
export function contextPlaceFa(shell: PlaceShell, facts: PlaceFacts): string {
  if (isOrgContext(shell, facts) || (shell.schools?.length ?? 0) > 1) return facts.orgName;
  return shell.schoolName ?? facts.schoolName ?? facts.orgName;
}

/**
 * The greeting card's meta line: «مدیر سازمان · <organization>» for the organization admin — unambiguous, the hat
 * says which level the name is — and the bare place for everyone else.
 */
export function contextLineFa(shell: PlaceShell, facts: PlaceFacts): { role: string | null; place: string } {
  const place = contextPlaceFa(shell, facts);
  return { role: isOrgContext(shell, facts) ? ROLE_LABELS.org_admin : null, place };
}
