"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

/** `toast("Copied — paste it into Claude")` from any client component under <ToastProvider>. */
export function useToast() {
  return useContext(ToastContext);
}

/** The design's `.toast`: light pill above the tab bar, 3.2 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-[calc(var(--tab-bar-height)+32px+env(safe-area-inset-bottom))] left-1/2 z-[80] w-[calc(100%-32px)] max-w-[440px] -translate-x-1/2 rounded-xl bg-toast px-4 py-3 text-sm font-medium text-toast transition-opacity duration-200 ${message ? "opacity-100" : "opacity-0"}`}
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}
