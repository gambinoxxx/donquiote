import { cn } from "@/lib/utils";

interface MarkProps {
  /** Outer square size in px. */
  size?: number;
  /** Adds the draw-in classes used by the splash. */
  animated?: boolean;
  className?: string;
}

/**
 * The Donquixote mark: lance and ring on an amber rounded square
 * (doc/design/loading.html). Decorative; label the surrounding element.
 */
export function Mark({ size = 96, animated = false, className }: MarkProps) {
  const icon = Math.round(size * 0.77);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center bg-accent text-on-accent",
        animated && "splash-mark",
        className,
      )}
      style={{ width: size, height: size, borderRadius: size / 4 }}
    >
      <svg viewBox="0 0 100 100" width={icon} height={icon}>
        <circle
          className={animated ? "splash-ring" : undefined}
          cx="46"
          cy="56"
          r="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
        />
        <line
          className={animated ? "splash-lance" : undefined}
          x1="14"
          y1="88"
          x2="74"
          y2="28"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <polygon
          className={animated ? "splash-tip" : undefined}
          points="88,14 68,24 78,34"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
