import type { NextConfig } from "next";

const buildCpus = Number(process.env.NEXT_BUILD_CPUS);

const nextConfig: NextConfig = {
  // Required by the Dockerfile: copies .next/standalone + .next/static + public into the runner image.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Never load anything from a third-party host (fonts, analytics, CDNs) — self-host everything.
  images: { remotePatterns: [] },
  experimental: {
    // `next build` spawns one page-data worker per CPU (11 here); on an 8 GB laptop with a dev server, Docker and
    // a browser open they crash natively (0xC0000005 / 0xC0000409). Size them by free memory instead, and let
    // `NEXT_BUILD_CPUS=2 pnpm build` pin the count explicitly.
    memoryBasedWorkersCount: true,
    ...(Number.isInteger(buildCpus) && buildCpus > 0 ? { cpus: buildCpus } : {}),
  },
};

export default nextConfig;
