"use server";
// «اولیا» actions of /admin (owner, 2026-10-18): add / unlink a guardian on the student page, a guardian's temporary
// password, and the class page's «ساخت حساب اولیا». Each names its permission (held at ANY scope — the service narrows
// to the caller's schools: NOT_FOUND outside, FORBIDDEN for a capability they lack). Plaintext passwords exist only
// in the returned Result.
import { defineAction } from "@/lib/actions";
import { addGuardian, bulkCreateClassGuardians, resetGuardianPassword, unlinkGuardian } from "@/modules/iam/guardian";
import { AddGuardianInput, ClassGuardiansInput, GuardianLinkIdInput } from "./guardian-dto";

/** «افزودن ولی»: name + phone + relation — creates or finds the guardian (the phone rules) and links them. */
export const addGuardianAction = defineAction({ schema: AddGuardianInput, permission: "iam.person.write", scope: "any" }, async (tx, input, ctx) =>
  addGuardian(tx, ctx, { studentProfileId: input.studentProfileId, firstName: input.firstName, lastName: input.lastName, phone: input.phone, relation: input.relation }),
);

/** «حذف از اولیا»: ends one link (the guardian's login closes when it was their last child here). */
export const unlinkGuardianAction = defineAction({ schema: GuardianLinkIdInput, permission: "iam.person.write", scope: "any" }, async (tx, input, ctx) =>
  unlinkGuardian(tx, ctx, { linkId: input.linkId }),
);

/** «تعیین رمز موقت» of a guardian-only account all of whose children the caller manages — the plaintext ONCE. */
export const resetGuardianPasswordAction = defineAction({ schema: GuardianLinkIdInput, permission: "iam.account.reset_password", scope: "any" }, async (tx, input, ctx) =>
  resetGuardianPassword(tx, ctx, { linkId: input.linkId }),
);

/** «ساخت حساب اولیا» of one class — idempotent; the counts tell the page what happened. */
export const bulkCreateGuardiansAction = defineAction({ schema: ClassGuardiansInput, permission: "iam.person.write", scope: "any" }, async (tx, input, ctx) =>
  bulkCreateClassGuardians(tx, ctx, { classGroupId: input.classGroupId }),
);
