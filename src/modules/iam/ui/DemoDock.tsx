"use client";

import { ChevronDown, Zap } from "lucide-react";
import { useActionState, useId, useRef, useState } from "react";
import { SelectNative } from "@/components/ui/select-native";
import type { Result } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { demoLoginFormAction } from "../demo-login/actions";
import type { DemoDirectory, DemoRole } from "../demo-login/labels";
import { DEMO_ACCOUNT_REQUIRED_MESSAGE, DEMO_GONE_MESSAGE } from "../demo-login/messages";

/** The panel's selects on the night glass — the shared `SelectNative` control, recoloured. */
const SELECT_CLASS =
  "border-white/15 bg-(--auth-field) text-(--auth-text) focus-visible:border-(--auth-sky) focus-visible:ring-(--auth-sky)/25 [&>option]:bg-(--auth-night-2) [&>option]:text-(--auth-text) [&_option]:bg-(--auth-night-2) [&_option]:text-(--auth-text) [&>optgroup]:bg-(--auth-night-2) [&>optgroup]:text-(--auth-muted)";
const SELECT_WRAPPER_CLASS = "[&>svg]:text-(--auth-muted)";

function firstAccount(role: DemoRole | undefined): string {
  return role?.groups[0]?.options[0]?.id ?? "";
}

/**
 * «ورود آزمایشی» (docs/decisions.md 2026-10-18; mock docs/mockups/login-v6.html `.dock`): a small pill at the bottom
 * end corner of /login that opens a panel of three native dropdowns — «مدرسه» → «نقش» → «حساب» — and «ورود». Rendered
 * ONLY when the server found the gate open (DEMO_LOGIN=1 and this device's unlock cookie); the list arrives as props
 * (labels + account ids) and the action re-checks everything, so this component is a convenience, never a gate.
 * Only the «حساب» select has a `name`: the server receives one user_account id and nothing else.
 */
export function DemoDock({ directory }: { directory: DemoDirectory }) {
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const pillRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [schoolKey, setSchoolKey] = useState(directory.schools[0]?.key ?? "");
  const school = directory.schools.find((s) => s.key === schoolKey) ?? directory.schools[0];
  const [roleKey, setRoleKey] = useState<string>(school?.roles[0]?.key ?? "");
  const role = school?.roles.find((r) => r.key === roleKey) ?? school?.roles[0];
  const [accountId, setAccountId] = useState(firstAccount(role));
  const [state, action, pending] = useActionState<Result<never> | null, FormData>(demoLoginFormAction, null);

  if (!school || !role) return null;

  const error =
    state && !state.ok
      ? state.code === "NOT_FOUND"
        ? DEMO_GONE_MESSAGE
        : state.code === "VALIDATION"
          ? DEMO_ACCOUNT_REQUIRED_MESSAGE
          : state.message
      : undefined;
  const roleCount = new Set(directory.schools.flatMap((s) => s.roles.map((r) => r.key))).size;

  const chooseSchool = (key: string) => {
    const next = directory.schools.find((s) => s.key === key);
    setSchoolKey(key);
    setRoleKey(next?.roles[0]?.key ?? "");
    setAccountId(firstAccount(next?.roles[0]));
  };
  const chooseRole = (key: string) => {
    setRoleKey(key);
    setAccountId(firstAccount(school.roles.find((r) => r.key === key)));
  };

  return (
    <div
      className="pointer-events-none fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] end-3 z-40 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col items-end gap-2 lg:bottom-5 lg:end-5"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          pillRef.current?.focus();
        }
      }}
    >
      <form id={panelId} action={action} hidden={!open} aria-labelledby={titleId} className="auth-dock pointer-events-auto w-full rounded-hero p-3">
        <div className="flex items-center gap-2 px-1 pb-2">
          <Zap className="size-4 shrink-0 text-(--auth-gold)" aria-hidden />
          <h2 id={titleId} className="text-meta font-bold text-(--auth-gold)">
            ورود آزمایشی
          </h2>
          <span className="ms-auto text-xs text-(--auth-muted)">فقط برای دورهٴ آزمایشی</span>
        </div>
        <div className="flex flex-col gap-2.5">
          <DockSelect id={`${panelId}-school`} label="مدرسه" value={school.key} onChange={chooseSchool}>
            {directory.schools.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </DockSelect>
          <DockSelect id={`${panelId}-role`} label="نقش" value={role.key} onChange={chooseRole}>
            {school.roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </DockSelect>
          <DockSelect id={`${panelId}-account`} label="حساب" name="accountId" value={accountId} onChange={setAccountId}>
            {role.groups.map((g) =>
              g.label ? (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ) : (
                g.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))
              ),
            )}
          </DockSelect>
        </div>
        <p role="alert" aria-live="polite" className="mt-2 px-1 text-sm text-(--auth-danger) empty:hidden">
          {error}
        </p>
        <button type="submit" className="auth-cta pressable mt-3 w-full" disabled={pending || accountId === ""}>
          {pending ? "در حال ورود…" : "ورود"}
        </button>
      </form>
      <button
        ref={pillRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="auth-dock pressable pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full ps-3.5 pe-3"
      >
        <Zap className="size-4 shrink-0 text-(--auth-gold)" aria-hidden />
        <span className="text-meta font-bold text-(--auth-gold)">ورود آزمایشی</span>
        <span className="text-xs text-(--auth-muted)">
          {directory.schools.length.toLocaleString("fa-IR")} مدرسه · {roleCount.toLocaleString("fa-IR")} نقش
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-(--auth-muted) transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
    </div>
  );
}

function DockSelect({
  id,
  label,
  name,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="px-1 text-meta font-semibold text-(--auth-muted)">
        {label}
      </label>
      <SelectNative
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
        wrapperClassName={SELECT_WRAPPER_CLASS}
      >
        {children}
      </SelectNative>
    </div>
  );
}
