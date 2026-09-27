// Strict Zod inputs of the people actions (students, staff, accounts, roles). Persian messages; nothing here is
// spread into a query — the services map fields explicitly.
import { z } from "zod";
import { ASSIGNABLE_ROLES } from "@/modules/iam/service";

const uuid = z.uuid("شناسه نامعتبر است.");
const personName = (label: string) => z.string().trim().min(1, `${label} را وارد کنید.`).max(80, `${label} حداکثر ۸۰ نویسه است.`);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const gender = z.enum(["female", "male"]).nullable().optional();

export const CreateStudentInput = z
  .object({
    firstName: personName("نام"),
    lastName: personName("نام خانوادگی"),
    gender,
    studentNumber: z.string().trim().min(1, "شمارهٴ دانش‌آموزی را وارد کنید.").max(20, "شمارهٴ دانش‌آموزی حداکثر ۲۰ نویسه است."),
    externalRef: optionalText(60),
    contactPhone: optionalText(20),
    guardianPhone: optionalText(20),
    /** School when no class is chosen (username prefix + scope). */
    schoolId: uuid.optional(),
    classGroupId: uuid.nullable().optional(),
    createAccount: z.boolean().default(true),
    /** Explicit login (phone or username); empty = phone, else `<school code>-<student number>`. */
    identifier: optionalText(64),
  })
  .strict();
export type CreateStudentInput = z.output<typeof CreateStudentInput>;

export const UpdateStudentInput = z
  .object({
    personId: uuid,
    firstName: personName("نام"),
    lastName: personName("نام خانوادگی"),
    gender,
    studentNumber: z.string().trim().min(1, "شمارهٴ دانش‌آموزی را وارد کنید.").max(20),
    externalRef: optionalText(60),
    contactPhone: optionalText(20),
    guardianPhone: optionalText(20),
  })
  .strict();
export type UpdateStudentInput = z.output<typeof UpdateStudentInput>;

/**
 * A new colleague: person + phone account + primary school. NO manager roles (owner, 2026-09-27): «مدیر مدرسه» and
 * «معاون» are granted on /admin/roles only (`AssignRoleInput`), never from the staff pages — `.strict()` refuses a
 * stray `roles` key instead of silently granting through a second door.
 */
export const CreateStaffInput = z
  .object({
    firstName: personName("نام"),
    lastName: personName("نام خانوادگی"),
    gender,
    phone: z.string().trim().min(1, "شمارهٴ موبایل را وارد کنید.").max(20),
    employeeNumber: optionalText(30),
    employmentType: z.enum(["full_time", "part_time", "contractor"]).default("full_time"),
    /** The school this staff member belongs to (scope anchor for school admins). */
    schoolId: uuid.nullable().optional(),
  })
  .strict();
export type CreateStaffInput = z.output<typeof CreateStaffInput>;

export const UpdateStaffInput = z
  .object({
    personId: uuid,
    firstName: personName("نام"),
    lastName: personName("نام خانوادگی"),
    gender,
    employeeNumber: optionalText(30),
    employmentType: z.enum(["full_time", "part_time", "contractor"]),
    /** Primary school (scope anchor); omitted = unchanged, null = detach (organization admins only). */
    schoolId: uuid.nullable().optional(),
  })
  .strict();
export type UpdateStaffInput = z.output<typeof UpdateStaffInput>;

export const PersonIdInput = z.object({ personId: uuid }).strict();

export const PlaceStudentInput = z.object({ personId: uuid, classGroupId: uuid }).strict();

export const CreateAccountInput = z.object({ personId: uuid, identifier: optionalText(64) }).strict();

/** «نقش جدید» on /admin/roles — the ONE request path that grants a manager role (the service re-runs the whole matrix). */
export const AssignRoleInput = z.object({ personId: uuid, roleCode: z.enum(ASSIGNABLE_ROLES), schoolId: uuid.nullable().optional() }).strict();

export const RevokeRoleInput = z.object({ roleAssignmentId: uuid }).strict();

export const EndTeachingInput = z.object({ teacherAssignmentId: uuid }).strict();

/**
 * «افزودن تدریس» on a colleague's page: a class, then EITHER an existing offering of it OR a درس to define in the
 * class's current نوبت, and the teaching role. `replaceMain` = the manager confirmed replacing the current main
 * teacher. An empty pick (`""`) reads as missing; the handler names which (src/lib/admin/teaching.ts).
 */
const emptyAsMissing = z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional());
export const AssignTeachingInput = z
  .object({
    personId: uuid,
    classGroupId: z.string("کلاس را انتخاب کنید.").min(1, "کلاس را انتخاب کنید.").pipe(uuid),
    classOfferingId: emptyAsMissing,
    subjectId: emptyAsMissing,
    role: z.enum(["main", "assistant", "substitute"], "نقش تدریس را انتخاب کنید.").default("main"),
    replaceMain: z.boolean().default(false),
  })
  .strict();
export type AssignTeachingInput = z.output<typeof AssignTeachingInput>;

export const PeopleListInput = z
  .object({
    q: z.string().trim().max(80).default(""),
    page: z.number().int().min(1).max(10_000).default(1),
    pending: z.boolean().default(false),
    noClass: z.boolean().default(false),
    classGroupId: uuid.optional(),
    /** Staff list: only the colleagues anchored to this school (the school hub links here). */
    schoolId: uuid.optional(),
  })
  .strict();

export const ClassIdInput = z.object({ classGroupId: uuid }).strict();
