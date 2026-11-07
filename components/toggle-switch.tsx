"use client";

import { cn } from "@/lib/utils";

/** The design's `.switch` (52 × 32, amber when on). */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-8 w-[52px] shrink-0 cursor-pointer justify-start rounded-2xl bg-[var(--border-input)] p-[3px] transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-checked:justify-end aria-checked:bg-accent",
      )}
    >
      <span className="size-[26px] rounded-full bg-foreground" />
    </button>
  );
}
