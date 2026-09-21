"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { Result } from "@/lib/actions";
import { changePasswordFormAction } from "../actions";
import { PasswordInput } from "./PasswordInput";

type ChangeResult = Result<{ revokedSessions: number }>;

interface ChangePasswordFormProps {
  /**
   * Voluntary «تغییر رمز» asks for «رمز فعلی»; the forced first-login change does not (the temporary password was
   * just typed at /login). The SERVER decides from `must_change_password` — this flag only shapes the form.
   */
  requireCurrent: boolean;
}

export function ChangePasswordForm({ requireCurrent }: ChangePasswordFormProps) {
  const [state, action, pending] = useActionState<ChangeResult | null, FormData>(changePasswordFormAction, null);
  const failed = state && !state.ok ? state : null;
  const currentError = failed?.fieldErrors?.currentPassword?.[0];
  const newError = failed?.fieldErrors?.newPassword?.[0];
  const confirmError = failed?.fieldErrors?.confirm?.[0];
  const formError = failed && !failed.fieldErrors ? failed.message : undefined;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {requireCurrent ? <PasswordInput name="currentPassword" label="رمز فعلی" autoComplete="current-password" error={currentError} /> : null}

      <ul id="password-hints" className="list-disc ps-5 text-sm text-muted-foreground">
        <li>دست‌کم ۸ نویسه</li>
        <li>نه شمارهٴ موبایل یا نام‌کاربری شما</li>
        <li>نه تکراری یا ترتیبی (مثل ۱۱۱۱۱۱۱۱ یا ۱۲۳۴۵۶۷۸)</li>
        <li>نه همان رمز قبلی</li>
      </ul>

      <PasswordInput name="newPassword" label="رمز جدید" autoComplete="new-password" error={newError} describedBy="password-hints" />
      <PasswordInput name="confirm" label="تکرار رمز جدید" autoComplete="new-password" error={confirmError} />

      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-danger">
        {formError}
      </p>

      <Button type="submit" size="lg" className="h-11 text-base" disabled={pending}>
        {pending ? "در حال ذخیره…" : "ذخیرهٴ رمز جدید"}
      </Button>
    </form>
  );
}
