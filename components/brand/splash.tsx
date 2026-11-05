import { Mark } from "./mark";

interface SplashProps {
  /** Muted line under the wordmark, e.g. "Checking your setups…". */
  status: string;
}

/**
 * Full-screen brand loader (ui-context.md → Loading States): the mark draws
 * in (ring → lance → tip) then breathes, with "Donquixote FX" and a status
 * line. CSS animations only; static under prefers-reduced-motion.
 * Visibility is controlled by <SplashGate>.
 */
export function Splash({ status }: SplashProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[18px] bg-base">
      <Mark size={96} animated />
      <div className="splash-word flex items-baseline gap-2">
        <span className="font-[family-name:var(--font-brand)] text-[26px] font-bold tracking-[-0.02em]">
          Donquixote
        </span>
        <span className="font-mono text-sm font-semibold tracking-[0.12em] text-accent">FX</span>
      </div>
      <p className="splash-status min-h-[18px] text-[13px] text-muted">{status}</p>
    </div>
  );
}
