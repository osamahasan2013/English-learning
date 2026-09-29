import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // A navigation, prefetch or Server Action that hits a dropped connection waits and
    // retries when the connection returns instead of throwing. Learning progress does not
    // depend on this: it is written to IndexedDB first and synced separately (see
    // src/lib/offline). See node_modules/next/dist/docs/01-app/02-guides/offline-support.md.
    useOffline: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Microphone is allowed for the optional read-aloud mode (same origin only).
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
