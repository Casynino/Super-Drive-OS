import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // hides the round "N" badge Next.js draws in the corner while developing (it covered the sidebar corner)
  devIndicators: false,
  // lets a second dev server (a preview with other data) run beside the normal one without sharing build files
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Product photos come straight from a phone camera, so uploads need more than the 1 MB default.
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
  serverExternalPackages: ["sharp"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
