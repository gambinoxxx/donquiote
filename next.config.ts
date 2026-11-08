import type { NextConfig } from "next";
import { clerkFrontendApiOrigin, securityHeaders } from "./lib/security-headers";

const headersForEveryRoute = securityHeaders({
  clerkOrigin: clerkFrontendApiOrigin(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
  dev: process.env.NODE_ENV !== "production",
});

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  async headers() {
    return [
      { source: "/:path*", headers: headersForEveryRoute },
      {
        // The service worker must never be cached, so updates reach devices.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
