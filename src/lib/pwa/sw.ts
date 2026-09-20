// Service worker source. Transpiled (not bundled) by scripts/build-sw.ts into public/sw.js + public/sw-routing.js
// and registered as a module worker by <ServiceWorkerRegistration/>. Shell-only caching: see should-cache.ts.
// No background sync, no push, no navigation caching. Lives in src/lib so it is type-checked and linted.
import { SHELL_CACHES, shouldCache } from "./should-cache";

// Minimal worker typings: tsconfig carries lib "dom", and the "webworker" lib cannot coexist with it in one program.
interface ExtendableEventLike extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): void;
}
interface WorkerScope {
  location: Location;
  caches: CacheStorage;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", listener: (e: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", listener: (e: FetchEventLike) => void): void;
}
declare const self: WorkerScope;

const OFFLINE_URL = "/~offline";
const OFFLINE_CACHE = "shell-offline";
const KNOWN = new Set<string>(SHELL_CACHES);

/** Cache the offline page and the static files its HTML references, so it renders styled without a network. */
async function precacheOffline(): Promise<void> {
  const cache = await self.caches.open(OFFLINE_CACHE);
  const res = await fetch(OFFLINE_URL, { credentials: "same-origin", cache: "no-cache" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put(OFFLINE_URL, res);
  const assets = new Set<string>();
  for (const m of html.matchAll(/(?:href|src)="(\/_next\/static\/[^"]+)"/g)) assets.add(m[1]!);
  const statics = await self.caches.open("shell-static");
  await Promise.all(
    [...assets].map(async (a) => {
      try {
        const r = await fetch(a);
        if (r.ok) await statics.put(a, r);
      } catch {
        /* one missing asset must not fail the install */
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheOffline().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await self.caches.keys();
      await Promise.all(keys.filter((k) => !KNOWN.has(k)).map((k) => self.caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await self.caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && (res.type === "basic" || res.type === "default")) await cache.put(request, res.clone());
  return res;
}

async function navigateOrOffline(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    const cache = await self.caches.open(OFFLINE_CACHE);
    const page = await cache.match(OFFLINE_URL);
    return page ?? new Response("اتصال اینترنت برقرار نیست.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(navigateOrOffline(request));
    return;
  }
  const decision = shouldCache(url, request, self.location.origin);
  if (decision.strategy === "cache-first") event.respondWith(cacheFirst(request, decision.cacheName));
  // network-only: fall through to the browser's default fetch
});
