import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required by the Dockerfile: copies .next/standalone + .next/static + public into the runner image.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Never load anything from a third-party host (fonts, analytics, CDNs) — self-host everything.
  images: { remotePatterns: [] },
};

export default nextConfig;
