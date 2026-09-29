/// <reference lib="webworker" />

// Built by `serwist build` into public/sw.js (serwist.config.js) and registered by
// components/layout/service-worker-registration.tsx. Precaches the app's static bundle and
// keeps copies of visited pages so a child can reopen the app and previously opened
// lessons with no connection. Learning progress itself is stored in IndexedDB by the app
// (src/lib/offline), not here.

import { ExpirationPlugin, NetworkFirst, Serwist } from "serwist";
import type { PrecacheEntry, RuntimeCaching } from "serwist";
import { defaultCache } from "@serwist/next/worker";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

const PAGES_CACHE = "pages";

const pages: RuntimeCaching = {
  matcher: ({ request, url, sameOrigin }) =>
    sameOrigin &&
    request.method === "GET" &&
    request.mode === "navigate" &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/auth/"),
  handler: new NetworkFirst({
    cacheName: PAGES_CACHE,
    networkTimeoutSeconds: 5,
    matchOptions: { ignoreVary: true },
    plugins: [
      {
        // Never keep error pages or redirects (a signed-out visit redirects to /login).
        cacheWillUpdate: async ({ response }) =>
          response.ok && !response.redirected && response.type === "basic" ? response : null,
      },
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 14 * 24 * 60 * 60 }),
    ],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [pages, ...defaultCache],
});

serwist.addEventListeners();
