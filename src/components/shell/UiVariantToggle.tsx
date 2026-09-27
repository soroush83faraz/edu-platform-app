"use client";

import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { RowMark } from "@/components/RowMark";
import { cn } from "@/lib/cn";
import type { UiVariant } from "@/lib/ui-variant";

/** Mirrors `UI_VARIANT_COOKIE` (`src/lib/ui-variant.ts` imports `next/headers`, so a client file cannot import it;
 *  `tests/unit/ui-variant.test.ts` keeps the two equal). */
export const UI_VARIANT_COOKIE_NAME = "donino-ui";

/** A per-viewer UI preference, no data: one year, the whole site, first-party only. */
export function writeUiVariantCookie(variant: UiVariant) {
  document.cookie = `${UI_VARIANT_COOKIE_NAME}=${variant}; path=/; max-age=31536000; samesite=lax`;
}

const OPTIONS: readonly { value: UiVariant; label: string }[] = [
  { value: "classic", label: "کلاسیک" },
  { value: "hub", label: "هاب" },
];

/**
 * «ظاهر آزمایشی» on «بیشتر» (owner trial, docs/decisions-pending/home-hub.md): a two-segment control «کلاسیک / هاب»
 * that writes the `donino-ui` cookie and reloads onto /home, so the whole shell (a server render) switches at once.
 * No server action: it is a viewer's own display preference, nothing is stored. 44 px segments.
 */
export function UiVariantToggle({ current }: { current: UiVariant }) {
  const [pending, setPending] = useState(false);
  function choose(variant: UiVariant) {
    if (variant === current || pending) return;
    writeUiVariantCookie(variant);
    setPending(true);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load on purpose: the shared layouts (and any shell the client router cached) must re-render in the new variant; a soft push would keep them.
    window.location.assign("/home");
  }
  return (
    <section aria-labelledby="ui-variant-title" className="surface-work flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <RowMark icon={FlaskConical} />
        <div className="flex min-w-0 flex-col">
          <h3 id="ui-variant-title" className="text-row text-text">
            ظاهر آزمایشی: همه‌چیز در خانه
          </h3>
          <p className="text-meta text-text-muted">بدون نوار پایین؛ حساب و اعلان‌ها در بالای صفحه</p>
        </div>
      </div>
      <div role="radiogroup" aria-labelledby="ui-variant-title" className="grid grid-cols-2 gap-1 rounded-full bg-surface-sunken p-1 ring-1 ring-line ring-inset">
        {OPTIONS.map((option) => {
          const selected = option.value === current;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={pending}
              onClick={() => choose(option.value)}
              className={cn(
                "pressable min-h-11 rounded-full px-4 text-sm transition-base",
                selected ? "bg-surface font-semibold text-primary-700 shadow-1" : "text-text-muted hover:text-text",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
