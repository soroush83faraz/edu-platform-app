"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Result } from "@/lib/actions";
import { loginFormAction } from "../actions";
import { PasswordInput } from "./PasswordInput";

interface LoginFormProps {
  /** Validated (`safeNextPath`) deep link to return to after login; the server re-validates it. */
  next?: string | null;
}

export function LoginForm({ next }: LoginFormProps) {
  const [state, action, pending] = useActionState<Result<never> | null, FormData>(loginFormAction, null);
  // React resets the form's UNCONTROLLED fields after every submission; the identifier is controlled so a failed
  // attempt keeps «موبایل یا نام‌کاربری» and clears only the password.
  const [identifier, setIdentifier] = useState("");
  const identifierError = state && !state.ok ? state.fieldErrors?.identifier?.[0] : undefined;
  const passwordError = state && !state.ok ? state.fieldErrors?.password?.[0] : undefined;
  const formError = state && !state.ok && !state.fieldErrors ? state.message : undefined;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="identifier">موبایل یا نام‌کاربری</Label>
        {/* dir="ltr" is the documented exception for phone inputs (CLAUDE.md). */}
        <Input
          id="identifier"
          name="identifier"
          dir="ltr"
          inputMode="tel"
          autoComplete="username"
          spellCheck={false}
          autoFocus
          required
          maxLength={64}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="h-12 rounded-xl bg-surface-sunken px-3 text-base"
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

      <label className="flex min-h-11 items-center gap-2.5 text-sm text-text">
        <input type="checkbox" name="publicDevice" className="size-5 rounded accent-primary" />
        <span>
          این دستگاه عمومی است
          <span className="block text-meta text-text-muted">ورود پس از ۸ ساعت خودبه‌خود پایان می‌گیرد.</span>
        </span>
      </label>

      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-danger">
        {formError}
      </p>

      <Button type="submit" size="lg" className="h-12 rounded-xl text-base font-semibold" disabled={pending}>
        {pending ? "در حال ورود…" : "ورود"}
      </Button>
    </form>
  );
}
