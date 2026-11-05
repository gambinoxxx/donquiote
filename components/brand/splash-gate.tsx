"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

/** Fade-out length; matches `.splash { transition }` in globals.css. */
const FADE_MS = 300;

function subscribeToLoad(onChange: () => void): () => void {
  window.addEventListener("load", onChange);
  document.addEventListener("readystatechange", onChange);
  return () => {
    window.removeEventListener("load", onChange);
    document.removeEventListener("readystatechange", onChange);
  };
}

/** True once the whole first response (incl. streamed page data) has arrived. */
const isDocumentComplete = () => document.readyState === "complete";
/** On the server, and during hydration, the splash is showing. */
const notCompleteOnServer = () => false;

/**
 * Shows the splash on a full page load only (cold start, or the full
 * reload right after sign-in) and hides it once:
 * 1. React has hydrated this layout (this component is running), and
 * 2. the document has finished loading — the streamed HTML response only
 *    ends after every server Suspense boundary (the page's data) has
 *    resolved, so the first page is ready.
 * Then it fades out over 300 ms and unmounts. No minimum time. The root
 * layout never remounts on client navigation, so tab switches never show
 * it again; they show each route's loading.tsx skeleton instead.
 */
export function SplashGate({ children }: { children: ReactNode }) {
  const loaded = useSyncExternalStore(subscribeToLoad, isDocumentComplete, notCompleteOnServer);
  const [gone, setGone] = useState(false);

  if (gone) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading Donquixote FX"
      aria-busy={!loaded}
      data-state={loaded ? "hiding" : "visible"}
      className="splash fixed inset-0 z-50"
      onTransitionEnd={() => setGone(true)}
      // Reduced motion has no transition, so transitionend never fires:
      // unmount on the next animation frame instead.
      ref={(node) => {
        if (!node || !loaded) return;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const id = reduced
          ? requestAnimationFrame(() => setGone(true))
          : window.setTimeout(() => setGone(true), FADE_MS + 100); // safety net
        return () => {
          if (reduced) cancelAnimationFrame(id);
          else window.clearTimeout(id);
        };
      }}
    >
      {children}
    </div>
  );
}
