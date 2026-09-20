"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "./ResponsiveModal";

export interface Credentials {
  name: string;
  loginIdentifier: string;
  initialPassword: string;
}

/**
 * Shows a freshly generated initial password ONCE. Nothing here is persisted client-side; closing the dialog is
 * final (the admin can print the credentials sheet later — the encrypted copy lives in the database).
 */
export function CredentialsDialog({ creds, onClose }: { creds: Credentials | null; onClose: () => void }) {
  return (
    <ResponsiveModal open={creds !== null} onOpenChange={(o) => (!o ? onClose() : undefined)} title="اطلاعات ورود" description="این رمز فقط همین یک‌بار نمایش داده می‌شود؛ در اولین ورود باید تغییر داده شود.">
      {creds ? (
        <div className="flex flex-col gap-3">
          <p className="text-base font-medium text-text">
            <bdi>{creds.name}</bdi>
          </p>
          <CredentialLine label="شناسهٴ ورود" value={creds.loginIdentifier} />
          <CredentialLine label="رمز اولیه" value={creds.initialPassword} />
          <CopyAllButton text={`${creds.name}\nشناسهٴ ورود: ${creds.loginIdentifier}\nرمز اولیه: ${creds.initialPassword}`} />
          <Button type="button" className="h-11" onClick={onClose}>
            متوجه شدم
          </Button>
        </div>
      ) : null}
    </ResponsiveModal>
  );
}

function CredentialLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <bdi dir="ltr" className="tabular select-all text-lg font-semibold tracking-wider text-text">
          {value}
        </bdi>
        <CopyButton text={value} label={`کپی ${label}`} />
      </span>
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard unavailable (http on a phone): the value is select-all-able */
    }
  };
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={copy} className="size-9">
      {done ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </Button>
  );
}

function CopyAllButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 gap-2"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          /* see CopyButton */
        }
      }}
    >
      {done ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {done ? "کپی شد" : "کپی همهٴ اطلاعات"}
    </Button>
  );
}
