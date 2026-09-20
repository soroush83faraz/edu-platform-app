import { describe, expect, it } from "vitest";
import { shouldCache } from "@/lib/pwa/should-cache";

const ORIGIN = "https://school.example.ir";
const get = (extra: Partial<Parameters<typeof shouldCache>[1]> = {}) => ({ method: "GET", ...extra });

describe("shouldCache", () => {
  it("caches hashed static assets and fonts of the same origin", () => {
    expect(shouldCache(`${ORIGIN}/_next/static/chunks/app.js`, get(), ORIGIN)).toEqual({ strategy: "cache-first", cacheName: "shell-static" });
    expect(shouldCache(`${ORIGIN}/_next/static/media/vazir.woff2`, get(), ORIGIN)).toEqual({ strategy: "cache-first", cacheName: "shell-fonts" });
    expect(shouldCache(`${ORIGIN}/icons/icon-192.png`, get(), ORIGIN)).toEqual({ strategy: "cache-first", cacheName: "shell-icons" });
    expect(shouldCache(`${ORIGIN}/apple-icon`, get(), ORIGIN)).toEqual({ strategy: "cache-first", cacheName: "shell-icons" });
  });

  it("never caches navigations, RSC payloads or /api", () => {
    expect(shouldCache(`${ORIGIN}/home`, get({ mode: "navigate" }), ORIGIN).strategy).toBe("network-only");
    expect(shouldCache(`${ORIGIN}/inbox?_rsc=abc`, get(), ORIGIN).strategy).toBe("network-only");
    expect(shouldCache(`${ORIGIN}/inbox`, get({ headers: new Headers({ RSC: "1" }) }), ORIGIN).strategy).toBe("network-only");
    expect(shouldCache(`${ORIGIN}/api/inbox/summary`, get(), ORIGIN).strategy).toBe("network-only");
    expect(shouldCache(`${ORIGIN}/`, get({ destination: "document" }), ORIGIN).strategy).toBe("network-only");
  });

  it("never caches non-GET requests, other origins or the worker itself", () => {
    expect(shouldCache(`${ORIGIN}/_next/static/chunks/app.js`, { method: "POST" }, ORIGIN).strategy).toBe("network-only");
    expect(shouldCache("https://cdn.example.com/_next/static/x.js", get(), ORIGIN).strategy).toBe("network-only");
    expect(shouldCache(`${ORIGIN}/sw.js`, get(), ORIGIN).strategy).toBe("network-only");
  });

  it("leaves unknown same-origin paths to the network", () => {
    expect(shouldCache(`${ORIGIN}/manifest.webmanifest`, get(), ORIGIN).strategy).toBe("network-only");
    expect(shouldCache(`${ORIGIN}/admin/students`, get(), ORIGIN).strategy).toBe("network-only");
  });
});
