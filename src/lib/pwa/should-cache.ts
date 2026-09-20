// The service worker's one routing decision, kept pure so it can be unit-tested: which requests may be served
// from the cache. The answer is "only the app shell": hashed static assets, icons and fonts of THIS origin.
// Navigations, RSC payloads, /api and anything with a session never touch the cache — a phone shared between two
// students must not show the first one's کارتابل to the second. Transpiled with the worker into public/ (see
// scripts/build-sw.ts), so it must stay free of imports.

export type CacheDecision = { strategy: "cache-first"; cacheName: "shell-static" | "shell-icons" | "shell-fonts" } | { strategy: "network-only" };

export const NETWORK_ONLY: CacheDecision = { strategy: "network-only" };

export interface RequestLike {
  method: string;
  /** `navigate` for page loads (Request.mode). */
  mode?: string;
  destination?: string;
  headers?: { get(name: string): string | null };
}

const FONT_RE = /\.(woff2?|ttf|otf)$/i;

/**
 * @param url the request URL (absolute)
 * @param request the Request (or the parts the decision needs)
 * @param origin the worker's own origin (`self.location.origin`)
 */
export function shouldCache(url: URL | string, request: RequestLike, origin: string): CacheDecision {
  const u = typeof url === "string" ? new URL(url) : url;
  if (request.method !== "GET") return NETWORK_ONLY;
  if (u.origin !== origin) return NETWORK_ONLY; // there are no third-party hosts, but never cache one by accident
  if (request.mode === "navigate" || request.destination === "document") return NETWORK_ONLY;
  if (u.searchParams.has("_rsc") || request.headers?.get("RSC") === "1" || request.headers?.get("Next-Router-State-Tree")) return NETWORK_ONLY;
  const p = u.pathname;
  if (p.startsWith("/api/")) return NETWORK_ONLY;
  if (p === "/sw.js" || p === "/sw-routing.js" || p.startsWith("/_next/webpack-hmr") || p.startsWith("/__nextjs")) return NETWORK_ONLY;
  if (p.startsWith("/_next/static/")) return FONT_RE.test(p) ? { strategy: "cache-first", cacheName: "shell-fonts" } : { strategy: "cache-first", cacheName: "shell-static" };
  if (p.startsWith("/icons/") || p === "/icon" || p.startsWith("/icon/") || p === "/apple-icon" || p.startsWith("/apple-icon/") || p === "/favicon.ico") {
    return { strategy: "cache-first", cacheName: "shell-icons" };
  }
  if (FONT_RE.test(p)) return { strategy: "cache-first", cacheName: "shell-fonts" };
  return NETWORK_ONLY;
}

/** Every cache the worker may create — deleted together on logout and on activation of a newer worker. */
export const SHELL_CACHES = ["shell-static", "shell-icons", "shell-fonts", "shell-offline"] as const;
