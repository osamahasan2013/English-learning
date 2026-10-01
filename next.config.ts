import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to this project, so a lockfile in a parent directory
  // (e.g. a checkout nested inside another project) is never mistaken for the root.
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    // A navigation, prefetch or Server Action that hits a dropped connection waits and
    // retries when the connection returns instead of throwing. Learning progress does not
    // depend on this: it is written to IndexedDB first and synced separately (see
    // src/lib/offline). See node_modules/next/dist/docs/01-app/02-guides/offline-support.md.
    useOffline: true,
    // Admin picture uploads are up to 1 MB (src/lib/content/media.ts) plus form overhead;
    // the default Server Action body limit is exactly 1 MB.
    serverActions: { bodySizeLimit: "2mb" },
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
