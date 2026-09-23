"use client";

/** Delete every Cache Storage entry of this origin (logout on a shared phone). The worker stays registered. */
export async function clearAllCaches(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* Cache Storage may be unavailable (private mode); the server's Clear-Site-Data still applies */
  }
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  // `minimal-ui` is the manifest's `display_override` fallback — installed too, just with a back/reload strip.
  const installed = (mode: string) => window.matchMedia?.(`(display-mode: ${mode})`).matches === true;
  return installed("standalone") || installed("minimal-ui") || nav.standalone === true;
}

export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}
