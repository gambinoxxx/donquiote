"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js (notifications) once the page has loaded, only in
 * browsers that support service workers and push. Renders nothing.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Not fatal: the Settings control reports when push is unavailable.
      });
  }, []);
  return null;
}
