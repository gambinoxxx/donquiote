/** "Donquixote FX" wordmark (Sora 700 + mono amber "FX"), as on the splash. */
export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="font-[family-name:var(--font-brand)] font-bold tracking-[-0.02em]" style={{ fontSize: size }}>
        Donquixote
      </span>
      <span className="font-mono text-sm font-semibold tracking-[0.12em] text-accent">FX</span>
    </span>
  );
}
