import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

// Which version is this? On Vercel it is the commit being built, so every push has its own id. It is written into BOTH the server code and the
// browser code of that build, so a page that stays open can ask the server "what is the newest version?" and tell the person when it differs
// (src/components/UpdateNotice.tsx, /api/version). Outside Vercel it is "dev" and the notice never shows.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
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
