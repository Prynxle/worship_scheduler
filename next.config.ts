import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        // Hashed, immutable build assets. Safe to cache forever.
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Authenticated, tenant-scoped API responses must never be cached.
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, no-cache, max-age=0, must-revalidate",
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
          { key: "Vary", value: "Authorization" },
        ],
      },
      {
        // HTML documents must revalidate; never use the immutable static-asset policy.
        source: "/((?!_next/static|api|.*\\\\..*).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
