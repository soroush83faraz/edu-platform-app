// The request id of the audit trail (security review 2026-10-19, D4): src/proxy.ts mints it for every route it runs
// for — Next's OWN matcher code decides which ones below — and the one route it skips, POST /api/files, mints its own
// (src/lib/request-id.ts), so a client can never choose `audit_log.request_id` by sending `x-request-id`.
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import type { ProxyMatcher } from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mintedRequestId, resolveRequestId, withMintedRequestId } from "@/lib/request-id";
import { config } from "@/proxy";

/** How `next build` compiles `config.matcher` (exported by the module, absent from its .d.ts). */
const { getMiddlewareMatchers } = pageStaticInfo as unknown as { getMiddlewareMatchers: (matcher: unknown, nextConfig: object) => ProxyMatcher[] };

const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("resolveRequestId / withMintedRequestId", () => {
  it("outside: the proxy's header when it is a UUID, a fresh id otherwise", () => {
    expect(resolveRequestId(CLIENT_ID)).toBe(CLIENT_ID);
    for (const bad of [null, "", "x".repeat(36), "------------------------------------", `${CLIENT_ID}\n`, "not-a-uuid"]) {
      const id = resolveRequestId(bad);
      expect(id, String(bad)).toMatch(UUID);
      expect(id).not.toBe(bad);
    }
    expect(mintedRequestId()).toBeUndefined();
  });

  it("inside: the minted id — never the header — the same one throughout the request, a new one per request", async () => {
    const seen = await withMintedRequestId(async () => {
      const first = resolveRequestId(CLIENT_ID);
      await new Promise((r) => setTimeout(r, 5));
      const later = await Promise.resolve().then(() => resolveRequestId(CLIENT_ID));
      return { first, later, own: mintedRequestId() };
    });
    expect(seen.first).toMatch(UUID);
    expect(seen.first).not.toBe(CLIENT_ID);
    expect(seen.later).toBe(seen.first);
    expect(seen.own).toBe(seen.first);
    const other = await withMintedRequestId(async () => resolveRequestId(CLIENT_ID));
    expect(other).not.toBe(seen.first);
  });
});

describe("the proxy matcher (Next's own compiler and runtime matcher)", () => {
  const runsProxy = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
  const runs = (pathname: string) => runsProxy(pathname, {} as never, {});

  it("skips exactly /api/files among the app's routes — the upload must not be buffered", () => {
    expect(runs("/api/files")).toBe(false);
    for (const p of ["/api/filesx", "/api/files/x", "/api/files/", "/files/0199a000-0000-7000-8000-0000000000f1", "/home", "/inbox/123", "/login", "/login/demo", "/api/inbox/summary"]) {
      expect(runs(p), p).toBe(true);
    }
  });

  it("still skips Next internals, the health probe, PWA files and static assets", () => {
    for (const p of ["/_next/static/chunks/main.js", "/api/health", "/sw.js", "/manifest.webmanifest", "/icons/icon-192.png", "/brand.svg"]) {
      expect(runs(p), p).toBe(false);
    }
  });
});

// POST /api/files itself: whatever `x-request-id` the client sends, the gate sees a server-made id.
const gateSaw: string[] = [];
vi.mock("@/lib/env", () => ({ env: { PUBLIC_ORIGIN: "https://school.test" } }));
vi.mock("@/modules/workspace/file-gates", () => ({
  authorizeUploadGate: vi.fn(async () => {
    gateSaw.push(resolveRequestId(CLIENT_ID)); // what getRequestId() (src/lib/ctx.ts) returns inside defineAction
    return { ok: false, code: "FORBIDDEN", message: "-" };
  }),
  recordUploadGate: vi.fn(),
  sweepOrphansGate: vi.fn(),
}));

describe("POST /api/files mints its own request id", () => {
  afterEach(() => {
    gateSaw.length = 0;
  });

  it("the client's x-request-id never reaches the gate (and so never the audit trail)", async () => {
    const { POST } = await import("@/app/api/files/route");
    const request = () =>
      new NextRequest("https://school.test/api/files?purpose=work_item", {
        method: "POST",
        headers: { origin: "https://school.test", "sec-fetch-site": "same-origin", "x-request-id": CLIENT_ID, "x-file-name": "a.pdf", "content-length": "3" },
        body: "abc",
      });
    const res = await POST(request());
    expect(res.status).toBe(403);
    await POST(request());
    expect(gateSaw).toHaveLength(2);
    for (const id of gateSaw) {
      expect(id).toMatch(UUID);
      expect(id).not.toBe(CLIENT_ID);
    }
    expect(gateSaw[0]).not.toBe(gateSaw[1]);
  }, 60_000); // importing the route (next/server, pino) is slow on a busy machine
});
