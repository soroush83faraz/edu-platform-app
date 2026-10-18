// Strict Zod inputs of the «اولیا» admin actions (the student page's card, the class page's bulk button). Persian
// messages; nothing here is spread into a query — the service (src/modules/iam/guardian.ts) maps every field itself.
import { z } from "zod";
import { GUARDIAN_RELATIONS } from "@/modules/iam/guardian-policy";

const uuid = z.uuid("گزینهٴ انتخاب‌شده نامعتبر است.");
const personName = (label: string) => z.string().trim().min(1, `${label} را وارد کنید.`).max(80, `${label} حداکثر ۸۰ نویسه است.`);

export const AddGuardianInput = z
  .object({
    studentProfileId: uuid,
    firstName: personName("نام"),
    lastName: personName("نام خانوادگی"),
    phone: z.string().trim().min(1, "شمارهٴ موبایل ولی را وارد کنید.").max(20),
    relation: z.enum(GUARDIAN_RELATIONS, "نسبت ولی را انتخاب کنید."),
  })
  .strict();
export type AddGuardianInput = z.output<typeof AddGuardianInput>;

export const GuardianLinkIdInput = z.object({ linkId: uuid }).strict();

export const ClassGuardiansInput = z.object({ classGroupId: uuid }).strict();

export const StudentGuardiansInput = z.object({ personId: uuid }).strict();
