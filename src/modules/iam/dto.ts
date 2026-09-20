// Zod v4 `.strict()` input schemas of the iam actions. Messages are Persian; field names match the form inputs.
import { z } from "zod";
import { zFormBoolean } from "@/lib/actions";

export const LoginInput = z
  .object({
    identifier: z.string().trim().min(1, "شمارهٴ موبایل یا نام‌کاربری را وارد کنید.").max(64, "شناسه بیش از حد طولانی است."),
    password: z.string().min(1, "رمز را وارد کنید.").max(128, "رمز بیش از حد طولانی است."),
    publicDevice: zFormBoolean(),
  })
  .strict();
export type LoginInput = z.output<typeof LoginInput>;

export const ChangePasswordInput = z
  .object({
    newPassword: z.string().min(1, "رمز جدید را وارد کنید.").max(128, "رمز بیش از حد طولانی است."),
    confirm: z.string().min(1, "تکرار رمز را وارد کنید.").max(128, "رمز بیش از حد طولانی است."),
  })
  .strict();
export type ChangePasswordInput = z.output<typeof ChangePasswordInput>;

export const EmptyInput = z.object({}).strict();
