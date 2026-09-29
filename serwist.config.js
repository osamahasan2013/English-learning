// Consumed by `serwist build` (see package.json's "build" script), which bundles
// src/sw.ts with esbuild and injects a precache manifest of the Next.js client bundle.
// Runs as a separate step because this app builds with Turbopack, and @serwist/next's
// webpack plugin cannot inject the manifest there. Same approach as the sibling precast
// app in this repository.
module.exports = {
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  globDirectory: ".next",
  globPatterns: ["static/**/*.{js,css,woff2}"],
  // Build artifacts Turbopack emits that the server does not serve; precaching them
  // would 404 and fail the service worker install.
  globIgnores: [
    "static/webpack/**/*",
    "static/*/_buildManifest.js",
    "static/*/_ssgManifest.js",
    "static/*/_clientMiddlewareManifest.js",
  ],
  modifyURLPrefix: {
    "static/": "/_next/static/",
  },
  esbuildOptions: {
    bundle: true,
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  },
};
