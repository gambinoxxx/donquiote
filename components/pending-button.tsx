"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

interface PendingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Force the saving state (for buttons not tied to a <form> action). */
  pending?: boolean;
  /** Label while saving, e.g. "Saving…". Defaults to the normal label. */
  pendingLabel?: ReactNode;
}

/**
 * A button for actions that save (Save changes, Restore, Taken / Skip):
 * shows an inline spinner and is disabled while saving — no full-page
 * loader. Inside a <form action={…}> it picks up the pending state
 * automatically via useFormStatus; otherwise pass `pending`.
 */
export function PendingButton({
  pending,
  pendingLabel,
  children,
  className,
  disabled,
  type = "submit",
  ...props
}: PendingButtonProps) {
  const form = useFormStatus();
  const isPending = pending ?? form.pending;

  return (
    <button
      type={type}
      disabled={disabled || isPending}
      aria-busy={isPending || undefined}
      className={cn("inline-flex items-center justify-center gap-2 disabled:opacity-60", className)}
      {...props}
    >
      {isPending ? <Spinner /> : null}
      {isPending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
