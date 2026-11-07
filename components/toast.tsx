"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

export interface ToastLink {
  href: string;
  label: string;
}

const ToastContext = createContext<(message: string, link?: ToastLink) => void>(() => {});

/** `toast("Copied — paste it into Claude")`, optionally with a link. */
export function useToast() {
  return useContext(ToastContext);
}

/** The design's `.toast`: light pill above the tab bar, 3.2 s (5 s with a link). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; link?: ToastLink } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string, link?: ToastLink) => {
    setToast({ message, link });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), link ? 5000 : 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-[calc(var(--tab-bar-height)+32px+env(safe-area-inset-bottom))] left-1/2 z-[80] flex w-[calc(100%-32px)] max-w-[440px] -translate-x-1/2 items-center justify-between gap-3 rounded-xl bg-toast px-4 py-3 text-sm font-medium text-toast transition-opacity duration-200 ${toast ? "opacity-100" : "opacity-0"}`}
      >
        <span>{toast?.message}</span>
        {toast?.link && (
          <Link href={toast.link.href} className="pointer-events-auto flex-none font-bold underline" onClick={() => setToast(null)}>
            {toast.link.label}
          </Link>
        )}
      </div>
    </ToastContext.Provider>
  );
}
