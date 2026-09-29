"use client";

import { useEffect } from "react";

// While offline, a client-side navigation would wait for the network (next.config.ts
// useOffline). Turning in-app link taps into full page loads lets the service worker
// answer from its saved copies instead, so previously opened screens and lessons open
// immediately.
export function OfflineNavigation() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (navigator.onLine || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey)
        return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target || anchor.origin !== window.location.origin) return;
      event.preventDefault();
      window.location.assign(anchor.href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
