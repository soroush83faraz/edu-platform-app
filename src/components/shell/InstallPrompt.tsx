"use client";

import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PhoneInstallClay } from "@/components/illustrations";
import { Button } from "@/components/ui/button";
import { isIosSafari, isStandalone } from "@/lib/pwa/client";

const DISMISS_KEY = "install-prompt-dismissed-at";
const DISMISS_DAYS = 7;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? "0");
    return Number.isFinite(at) && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* storage blocked: the banner simply returns next visit */
  }
}

/**
 * «نصب برنامه روی گوشی»: Android/Chrome gets the native prompt (deferred `beforeinstallprompt`); iOS Safari gets
 * the three-step sheet. Hidden when already installed (`display-mode: standalone` / `minimal-ui`, iOS
 * `navigator.standalone`) or dismissed within 7 days. Installing IS the answer to «the address bar is ugly»: only
 * the Home Screen icon opens without browser chrome (manifest `display`, docs/pwa.md «نصب روی گوشی»).
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<"hidden" | "android" | "ios">("hidden");
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return;
    if (isIosSafari()) {
      // No install event on iOS: show the guide once the frame after mount (not during the effect body).
      const t = window.setTimeout(() => setMode("ios"), 0);
      return () => window.clearTimeout(t);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setMode("android");
    };
    const onInstalled = () => setMode("hidden");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "hidden") return null;

  const dismiss = () => {
    remember();
    setMode("hidden");
    setSheet(false);
  };

  const install = async () => {
    if (mode === "ios") {
      setSheet(true);
      return;
    }
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setMode("hidden");
    else dismiss();
  };

  return (
    <>
      <section aria-labelledby="install-heading" className="banner-in flex items-center gap-3 rounded-card bg-info-soft p-3 pe-2">
        <PhoneInstallClay size={56} className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 id="install-heading" className="text-sm font-semibold text-primary-900">
            نصب برنامه روی گوشی
          </h3>
          <p className="text-meta text-primary-800">بدون فروشگاه؛ یک آیکون روی صفحهٴ اصلی که بدون نوار مرورگر باز می‌شود.</p>
          <div className="mt-2 flex items-center gap-1">
            <Button type="button" size="sm" className="font-semibold" onClick={install}>
              {mode === "ios" ? "راهنمای نصب" : "نصب"}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-primary-800" onClick={dismiss}>
              بعداً
            </Button>
          </div>
        </div>
        <button type="button" onClick={dismiss} aria-label="بستن" className="pressable grid size-11 shrink-0 place-items-center self-start rounded-full text-primary-800 hover:bg-info/60">
          <X className="size-4" aria-hidden />
        </button>
      </section>

      {sheet ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-heading"
          className="overlay-in fixed inset-0 z-40 flex items-end justify-center bg-primary-900/50 p-3 md:items-center"
          onClick={() => setSheet(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSheet(false);
          }}
        >
          <div className="sheet-in w-full max-w-sm rounded-hero bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-1" onClick={(e) => e.stopPropagation()}>
            <h3 id="ios-heading" className="text-base font-semibold text-text">
              نصب در آیفون و آی‌پد
            </h3>
            <ol className="mt-3 flex flex-col gap-3 text-sm text-text">
              <li className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-info-soft text-primary-800">
                  <Share className="size-4" aria-hidden />
                </span>
                در نوار پایین سافاری دکمهٴ «هم‌رسانی» را بزنید.
              </li>
              <li className="flex items-center gap-3">
                <span className="tabular grid size-8 shrink-0 place-items-center rounded-full bg-info-soft text-sm font-semibold text-primary-800">۲</span>
                «افزودن به صفحهٴ اصلی» را انتخاب کنید.
              </li>
              <li className="flex items-center gap-3">
                <span className="tabular grid size-8 shrink-0 place-items-center rounded-full bg-info-soft text-sm font-semibold text-primary-800">۳</span>
                بالای صفحه «افزودن» را بزنید.
              </li>
            </ol>
            <Button type="button" autoFocus className="mt-5 w-full" onClick={dismiss}>
              متوجه شدم
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
