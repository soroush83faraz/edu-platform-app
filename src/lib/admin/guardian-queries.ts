// Read side of «اولیا» in /admin: a student's «اولیا» card and a class's printable guardians sheet. Same gate as the
// other people reads (`iam.person.read` / `iam.account.reset_password` at any scope); the service applies the admin
// scope rule (NOT_FOUND outside it). The sheet writes `iam.credentials.printed` like the students' one — rendering it
// IS the event that exposes the passwords.
import { defineQuery } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { listClassGuardianCredentials, listGuardiansOfStudent } from "@/modules/iam/guardian";
import { ClassGuardiansInput, StudentGuardiansInput } from "./guardian-dto";

/** The live guardians of a student (by the student's person id — the person page's key). No password. */
export const studentGuardiansQuery = defineQuery({ schema: StudentGuardiansInput, permission: "iam.person.read", scope: "any" }, async (tx, input, ctx) =>
  listGuardiansOfStudent(tx, ctx, input.personId),
);

/** «برگه‌های ورود اولیا» of one class (the passwords only where the caller may act as that guardian — the service). */
export const classGuardianCredentialsQuery = defineQuery({ schema: ClassGuardiansInput, permission: "iam.account.reset_password", scope: "any" }, async (tx, input, ctx) => {
  const data = await listClassGuardianCredentials(tx, ctx, input.classGroupId);
  await audit(ctx, "iam.credentials.printed", { schema: "tenancy", table: "class_group", id: input.classGroupId }, null, { kind: "guardians", count: data.rows.length }, tx);
  return data;
});
