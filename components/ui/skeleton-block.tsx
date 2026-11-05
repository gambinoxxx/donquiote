import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface SkeletonBlockProps {
  className?: string;
  /** Width in px (number) or any CSS length. Omit to fill the row. */
  width?: number | string;
  /** Height in px (number) or any CSS length. */
  height?: number | string;
  style?: CSSProperties;
}

/**
 * One grey placeholder block (`--skeleton`, radius 6px) with a subtle
 * shimmer; static under prefers-reduced-motion. Decorative: put
 * `aria-busy="true"` on the container, not on each block.
 */
export function SkeletonBlock({ className, width, height, style }: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton-block shrink-0 rounded-[6px] bg-skeleton", className)}
      style={{ width, height, ...style }}
    />
  );
}
