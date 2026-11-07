"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { PendingButton } from "./pending-button";

/** Bottom sheet that asks before a decision (the design's `.sheet`). */
export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-backdrop" onClick={() => !pending && onCancel()} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="fixed inset-x-0 bottom-0 z-[71] mx-auto flex max-w-[480px] flex-col gap-3.5 rounded-t-[20px] border-t border-default bg-surface px-4 pt-5 pb-[calc(28px+env(safe-area-inset-bottom))]"
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <div className="text-sm text-body">{children}</div>
        <div className="flex gap-2.5">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-[52px] flex-1 rounded-xl border border-input font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
          <PendingButton
            type="button"
            pending={pending}
            onClick={onConfirm}
            className="h-[52px] flex-[2] rounded-xl bg-accent font-bold text-on-accent"
          >
            {confirmLabel}
          </PendingButton>
        </div>
      </div>
    </>
  );
}
