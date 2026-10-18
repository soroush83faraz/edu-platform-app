"use client";

import { Smartphone } from "lucide-react";
import { useActionState, useState } from "react";
import type { Result } from "@/lib/actions";
import { loginFormAction } from "../actions";
import { AuthField } from "./AuthField";
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
    <form action={action} className="mt-1 flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <AuthField id="identifier" label="موبایل یا نام‌کاربری" icon={<Smartphone aria-hidden />} error={identifierError} errorId="identifier-error">
        {/* dir="ltr" is the documented exception for phone inputs (CLAUDE.md); `text-end` keeps the digits beside the glyph. */}
        <input
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
          className="text-end"
          aria-invalid={identifierError ? true : undefined}
          aria-describedby={identifierError ? "identifier-error" : undefined}
        />
      </AuthField>

      <PasswordInput name="password" label="رمز" autoComplete="current-password" error={passwordError} />

      {/* Always in the tree (a live region must exist before it speaks); empty, it takes no room. */}
      <p role="alert" aria-live="polite" className="text-sm text-(--auth-danger) empty:-mt-4">
        {formError}
      </p>

      <button type="submit" className="auth-cta pressable mt-1.5 w-full" disabled={pending}>
        {pending ? "در حال ورود…" : "ورود"}
      </button>
    </form>
  );
}
