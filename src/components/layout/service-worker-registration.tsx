"use client";

import { useEffect } from "react";

// Registers the service worker built by `serwist build` (public/sw.js) so the app shell,
// static assets and visited pages load with no network. Best-effort: without it the app
// still works online.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
