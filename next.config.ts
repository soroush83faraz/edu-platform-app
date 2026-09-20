import type { NextConfig } from "next";

const buildCpus = Number(process.env.NEXT_BUILD_CPUS);
const isDev = process.env.NODE_ENV === "development";

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

const nextConfig: NextConfig = {
  // Required by the Dockerfile: copies .next/standalone + .next/static + public into the runner image.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Never load anything from a third-party host (fonts, analytics, CDNs) — self-host everything.
  images: { remotePatterns: [] },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
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
