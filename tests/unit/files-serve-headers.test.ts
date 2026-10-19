// The headers a browser REALLY receives from GET /files/<id> and POST /api/files (security review 2026-10-19, D1),
// computed with Next's own code, in the order the server runs it:
//   1. next.config.ts `headers()` → `loadCustomRoutes` + the router's `buildCustomRoute` (the same regexes);
//   2. every matching rule is set on the response (resolve-routes.js → router-server.js `res.setHeader`);
//   3. the route handler's Response goes through `sendResponse` (send-response.js), which ADDS a handler header only
//      where none of that name is present yet.
// Before the fix the app-wide rule matched `/files/*` too, so step 3 dropped the download's sandbox CSP and its
// `no-referrer` — the last case below keeps that mechanism on record.
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { NextConfig } from "next";
import loadCustomRoutes from "next/dist/lib/load-custom-routes";
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node";
import { buildCustomRoute } from "next/dist/server/lib/router-utils/filesystem";
import { sendResponse } from "next/dist/server/send-response";
import { describe, expect, it } from "vitest";
import { FILE_RESPONSE_SECURITY_HEADERS, fileResponseHeaders } from "@/modules/files/serve";
import nextConfig from "../../next.config";

const FILE_ID = "0199a000-0000-7000-8000-0000000000f1";

/** What the server sends for `pathname` when the route handler answers `response` (HEAD: headers only, no socket needed). */
async function served(pathname: string, response: Response, config: NextConfig = nextConfig): Promise<Record<string, string>> {
  const routes = (await loadCustomRoutes(config)).headers.map((h) => buildCustomRoute("header", h));
  const routing: Record<string, string> = {};
  for (const route of routes) {
    if (!route.match(pathname)) continue;
    for (const { key, value } of route.headers) routing[key] = value;
  }
  const raw = new ServerResponse(new IncomingMessage(new Socket()));
  for (const key of Object.keys(routing)) raw.setHeader(key, routing[key]);
  const incoming = Object.assign(new IncomingMessage(new Socket()), { method: "HEAD", url: pathname });
  await sendResponse(new NodeNextRequest(incoming), new NodeNextResponse(raw), response);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.getHeaders())) out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  return out;
}

const lower = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
const FILE_SET = lower(FILE_RESPONSE_SECURITY_HEADERS);

describe("GET /files/<id> — the final header set (Next's routing + sendResponse)", () => {
  it("an image: the route's sandbox CSP, no-referrer, DENY, nosniff, same-origin, no-store — and nothing of the app-wide set", async () => {
    const h = await served(`/files/${FILE_ID}`, new Response(null, { status: 200, headers: fileResponseHeaders("png", "عکس.png", 1234) }));
    expect(h).toMatchObject(FILE_SET);
    expect(h["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox");
    expect(h["content-security-policy"]).not.toContain("script-src");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["permissions-policy"]).toBeUndefined();
    expect(h["content-type"]).toBe("image/png");
    expect(h["content-disposition"].startsWith("inline;")).toBe(true);
  });

  it("the route's own refusals (404 text, 303 to the login) carry the same set — it comes from next.config.ts for /files/*", async () => {
    const notFound = await served(`/files/${FILE_ID}`, new Response("موردی یافت نشد.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
    expect(notFound).toMatchObject(FILE_SET);
    const login = await served(`/files/${FILE_ID}`, new Response(null, { status: 303, headers: { Location: "/login" } }));
    expect(login).toMatchObject(FILE_SET);
    expect((await served("/files", new Response(null)))["content-security-policy"]).toBe(FILE_SET["content-security-policy"]);
  });

  it("next.config.ts's /files set is exactly src/modules/files/serve.ts's (a change to one must reach the other)", async () => {
    const rule = (await loadCustomRoutes(nextConfig)).headers.find((r) => r.source === "/files/:path*");
    expect(rule).toBeDefined();
    expect(Object.fromEntries(rule!.headers.map((x) => [x.key.toLowerCase(), x.value]))).toEqual(FILE_SET);
  });
});

describe("POST /api/files and every other path", () => {
  it("/api/files answers with its own strict set, not the pages' CSP", async () => {
    const h = await served("/api/files", Response.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } }));
    expect(h["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'; sandbox");
    expect(h).toMatchObject({ "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin", "cache-control": "no-store" });
  });

  it("pages keep the app-wide set; the exclusion is exact (`/filesx`, `/api/files/x`, `/api/filesx` are pages like any other)", async () => {
    for (const p of ["/home", "/inbox/123", "/filesx", "/api/files/x", "/api/filesx", "/admin/files"]) {
      const h = await served(p, new Response(null));
      expect(h["content-security-policy"], p).toContain("script-src 'self'");
      expect(h["referrer-policy"], p).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"], p).toBe("camera=(), microphone=(), geolocation=()");
    }
  });

  it("the mechanism of the bug: an app-wide rule that also matches /files/* wins over the route's own headers", async () => {
    const before: NextConfig = {
      async headers() {
        return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: "default-src 'self'" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] }];
      },
    };
    const h = await served(`/files/${FILE_ID}`, new Response(null, { headers: fileResponseHeaders("pdf", "a.pdf", 1) }), before);
    expect(h["content-security-policy"]).toBe("default-src 'self'");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["cross-origin-resource-policy"]).toBe("same-origin"); // a name the rule does not set still gets through
  });
});
