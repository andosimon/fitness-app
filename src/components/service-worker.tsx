"use client";

import { useEffect } from "react";

/**
 * Registers the service worker.
 *
 * Production only. In development, a caching worker fights hot reload and
 * serves stale bundles, which produces baffling behaviour. Verify the offline
 * path with `npm run build && npm start` instead of `npm run dev`.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // `updateViaCache: "none"` stops the browser serving a stale sw.js from its
    // own HTTP cache, which would pin the app to an old worker.
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Registration failing is not fatal — the app works online regardless.
      });
  }, []);

  return null;
}
