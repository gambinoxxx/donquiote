"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js (notifications + offline page) at root scope once the
 * page has loaded, in every browser with service workers (an iPhone Safari
 * tab has no push but still gets the offline page). Renders nothing.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Not fatal: the Settings control reports when push is unavailable.
      });
  }, []);
  return null;
}
