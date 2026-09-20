"use client";

import { useEffect } from "react";

/** Registers /sw.js (module worker, scope "/") in production only. Nothing else — no update prompts in phase 1. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { type: "module", scope: "/" }).catch(() => {
      /* registration is best-effort: the app works without it */
    });
  }, []);
  return null;
}
