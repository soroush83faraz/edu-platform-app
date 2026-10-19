import type { NextConfig } from "next";

const buildCpus = Number(process.env.NEXT_BUILD_CPUS);
const isDev = process.env.NODE_ENV === "development";

// The cPanel/Passenger deployment may be mounted on a sub-path of the domain (e.g. https://3d-ul.ir/extra/66/school)
// instead of its own subdomain, and Next must know that at BUILD time so every route and asset URL carries the prefix.
// Set by the CI build (`BASE_PATH` repository variable, docs/ops/cpanel-deploy.md); unset or empty = served from the
// domain root, which is the Docker/Caddy path and the default.
const basePath = (process.env.BASE_PATH ?? "").trim().replace(/\/+$/, "");

// Content Security Policy. Next's inline bootstrap scripts need 'unsafe-inline' (nonces are deferred: they force
// every page dynamic and the app already is); dev additionally needs 'unsafe-eval' for React Refresh. Everything
// is same-origin by design — no fonts, analytics or CDNs. HSTS is Caddy's job (deploy/Caddyfile).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// How Next merges headers (node_modules/next/dist/server/lib/router-server.js, server/send-response.js): the rules
// below are set on the response FIRST, and a route handler's own header is added only where none of that name is
// there yet. So the global set must not match the two file routes, or it silently replaces their stricter values
// (security review 2026-10-19, D1 — the download's sandbox CSP and `no-referrer` were dropped). Each file route gets
// its own complete set here; GET /files/<id> sends the same one itself (src/modules/files/serve.ts — kept equal by
// tests/unit/files-serve-headers.test.ts).
//   • /files/<id> — an upload, untrusted content: no source at all, an opaque-origin sandbox, never framed, never
//     embedded by another site, no referrer, never stored;
//   • /api/files — the upload endpoint's JSON answers: nothing to render, nothing to frame.
const fileHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Cache-Control", value: "private, no-store" },
];

const uploadApiHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; sandbox" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Required by the Dockerfile: copies .next/standalone + .next/static + public into the runner image.
  output: "standalone",
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  // Never load anything from a third-party host (fonts, analytics, CDNs) — self-host everything.
  images: { remotePatterns: [] },
  async headers() {
    return [
      // Everything but `/files`, `/files/…` and exactly `/api/files` (a path like `/filesx` or `/api/files/x` keeps it).
      { source: "/((?!files(?:/|$)|api/files$).*)", headers: securityHeaders },
      { source: "/files/:path*", headers: fileHeaders },
      { source: "/api/files", headers: uploadApiHeaders },
      // The worker must be re-fetched on every check so a new release replaces it promptly.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      { source: "/sw-routing.js", headers: [{ key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" }] },
    ];
  },
  experimental: {
    // `next build` spawns one page-data worker per CPU (11 here); on an 8 GB laptop with a dev server, Docker and
    // a browser open they crash natively (0xC0000005 / 0xC0000409). Size them by free memory instead, and let
    // `NEXT_BUILD_CPUS=2 pnpm build` pin the count explicitly.
    memoryBasedWorkersCount: true,
    ...(Number.isInteger(buildCpus) && buildCpus > 0 ? { cpus: buildCpus } : {}),
  },
};

export default nextConfig;
