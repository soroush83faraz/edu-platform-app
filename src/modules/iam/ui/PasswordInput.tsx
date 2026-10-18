"use client";

import { Eye, EyeOff, Lock } from "lucide-react";
import { useId, useState } from "react";
import { AuthField } from "./AuthField";

interface PasswordInputProps {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  describedBy?: string;
}

/** Password field of the auth door: a lock glyph and a ≥ 44 px visibility toggle (the eye). */
export function PasswordInput({ name, label, autoComplete, error, describedBy }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <AuthField
      id={id}
      label={label}
      icon={<Lock aria-hidden />}
      error={error}
      errorId={errorId}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "پنهان‌کردن رمز" : "نمایش رمز"}
          aria-pressed={visible}
          aria-controls={id}
          className="auth-field-toggle"
        >
          {visible ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
        </button>
      }
    >
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required
        maxLength={128}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined}
      />
    </AuthField>
  );
}
