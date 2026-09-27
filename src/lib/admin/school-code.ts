// «کد مدرسه» (`tenancy.school.code`, e.g. «ALK») is the organization admin's alone (owner, 2026-09-27): a
// school-scoped manager (principal, vice principal) never sees it — not on the school hub, the schools list, a
// picker or a form. Every read that feeds a page selects/sends the code only when `seesSchoolCode` is true; hiding
// it in markup is not enough. Generated usernames that embed it («alk-1234») are login identifiers and stay visible
// where they are shown today (credentials sheets, the person page). Pure — no DB import, unit-testable.
import type { AdminScope } from "@/modules/iam/service";

export function seesSchoolCode(scope: AdminScope): boolean {
  return scope.kind === "organization";
}

/** `row` as this caller may receive it: the `code` field is dropped for a school-scoped manager. */
export function withSchoolCodeFor<T extends { code: string }>(scope: AdminScope, row: T): Omit<T, "code"> & { code?: string } {
  if (seesSchoolCode(scope)) return row;
  const rest: Omit<T, "code"> & { code?: string } = { ...row };
  delete rest.code;
  return rest;
}
