// Read side of the people pages. Same gate as the actions; `iam.person.read` at any scope + the admin scope rule.
// The credentials queries also write the `iam.credentials.printed` audit row (rendering the sheet IS the event).
import { z } from "zod";
import { defineQuery } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { assertSchoolInScope, getAdminScope, roleGrantOptions } from "@/modules/iam/service";
import { findSchoolById, listSchools } from "@/modules/tenancy/repo";
import { PAGE_SIZE } from "./defineResource";
import { classOptionsInScope, getPersonDetail, listClassCredentials, listStaff, listStudents, personCredential } from "./people";
import { ClassIdInput, PeopleListInput, PersonIdInput } from "./people-dto";
import { staffOptions } from "./resources";

export const studentsListQuery = defineQuery({ schema: PeopleListInput, permission: "iam.person.read", scope: "any" }, async (tx, input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  // `?school=` narrows the list to one school's own students (the school hub's link); out of scope = NOT_FOUND.
  if (input.schoolId) assertSchoolInScope(scope, input.schoolId);
  const page = await listStudents(tx, scope, { q: input.q, page: input.page, pageSize: PAGE_SIZE, pending: input.pending, noClass: input.noClass, classGroupId: input.classGroupId, schoolId: input.schoolId });
  const school = input.schoolId ? await findSchoolById(tx, input.schoolId) : null;
  return { ...page, page: input.page, pageSize: PAGE_SIZE, scope, school: school ? { id: school.id, name: school.name } : null };
});

export const staffListQuery = defineQuery({ schema: PeopleListInput, permission: "iam.person.read", scope: "any" }, async (tx, input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  // `?school=` narrows the list to one school's own staff (the school hub's link); out of scope = NOT_FOUND.
  if (input.schoolId) assertSchoolInScope(scope, input.schoolId);
  const page = await listStaff(tx, scope, { q: input.q, page: input.page, pageSize: PAGE_SIZE, schoolId: input.schoolId });
  const school = input.schoolId ? await findSchoolById(tx, input.schoolId) : null;
  return { ...page, page: input.page, pageSize: PAGE_SIZE, scope, school: school ? { id: school.id, name: school.name } : null };
});

/**
 * What the student/staff forms need: classes and schools of the scope, plus the roles the caller may grant and where
 * (`roleGrantOptions` — computed server-side from the caller's assignments; the service enforces the same rule).
 */
export const peopleFormOptionsQuery = defineQuery({ permission: "iam.person.read", scope: "any" }, async (tx, _input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  const schools = (await listSchools(tx)).filter((s) => scope.kind === "organization" || scope.schoolIds.includes(s.id)).map((s) => ({ value: s.id, label: s.name, code: s.code }));
  return {
    scope,
    classes: await classOptionsInScope(tx, scope),
    schools,
    roleGrant: roleGrantOptions(ctx.assignments, schools),
  };
});

export const personDetailQuery = defineQuery({ schema: PersonIdInput, permission: "iam.person.read", scope: "any" }, async (tx, input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  const detail = await getPersonDetail(tx, scope, input.personId, ctx.assignments);
  const schools = (await listSchools(tx)).filter((s) => scope.kind === "organization" || scope.schoolIds.includes(s.id)).map((s) => ({ value: s.id, label: s.name }));
  return { detail, scope, classes: detail.student ? await classOptionsInScope(tx, scope) : [], schools, roleGrant: roleGrantOptions(ctx.assignments, schools) };
});

export const classCredentialsQuery = defineQuery({ schema: ClassIdInput, permission: "iam.account.reset_password", scope: "any" }, async (tx, input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  const data = await listClassCredentials(tx, scope, input.classGroupId);
  await audit(ctx, "iam.credentials.printed", { schema: "tenancy", table: "class_group", id: input.classGroupId }, null, { count: data.rows.length }, tx);
  return data;
});

export const personCredentialsQuery = defineQuery({ schema: PersonIdInput, permission: "iam.account.reset_password", scope: "any" }, async (tx, input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  const data = await personCredential(tx, scope, input.personId);
  await audit(ctx, "iam.credentials.printed", { schema: "iam", table: "person", id: input.personId }, null, { count: 1 }, tx);
  return data;
});

/** Roster of a class + the staff list for the class page. */
export const classRosterQuery = defineQuery({ schema: ClassIdInput, permission: "iam.person.read", scope: "any" }, async (tx, input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  const page = await listStudents(tx, scope, { q: "", page: 1, pageSize: 500, classGroupId: input.classGroupId });
  return { rows: page.rows, total: page.total, classes: await classOptionsInScope(tx, scope) };
});

export const EmptySchema = z.object({}).strict();
export { staffOptions };
