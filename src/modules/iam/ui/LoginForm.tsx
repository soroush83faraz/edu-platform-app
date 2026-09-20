"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Result } from "@/lib/actions";
import { loginFormAction } from "../actions";
import { PasswordInput } from "./PasswordInput";

export function LoginForm() {
  const [state, action, pending] = useActionState<Result<never> | null, FormData>(loginFormAction, null);
  const identifierError = state && !state.ok ? state.fieldErrors?.identifier?.[0] : undefined;
  const passwordError = state && !state.ok ? state.fieldErrors?.password?.[0] : undefined;
  const formError = state && !state.ok && !state.fieldErrors ? state.message : undefined;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="identifier">موبایل یا نام‌کاربری</Label>
        {/* dir="ltr" is the documented exception for phone inputs (CLAUDE.md). */}
        <Input
          id="identifier"
          name="identifier"
          dir="ltr"
          inputMode="tel"
          autoComplete="username"
          autoFocus
          required
          maxLength={64}
          className="h-11 text-base"
          aria-invalid={identifierError ? true : undefined}
          aria-describedby={identifierError ? "identifier-error" : undefined}
        />
        {identifierError ? (
          <p id="identifier-error" className="text-sm text-danger">
            {identifierError}
          </p>
        ) : null}
      </div>

      <PasswordInput name="password" label="رمز" autoComplete="current-password" error={passwordError} />

      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="publicDevice" className="size-5 accent-primary" />
        این دستگاه عمومی است
      </label>

      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-danger">
        {formError}
      </p>

      <Button type="submit" size="lg" className="h-11 text-base" disabled={pending}>
        {pending ? "در حال ورود…" : "ورود"}
      </Button>
    </form>
  );
}
