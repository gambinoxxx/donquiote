// Indicators exactly as in doc/reference/others.py (gemini) and prov1.py.

/**
 * Exponential moving average, seeded with the first value:
 * m = v0; then m = α·v + (1 − α)·m with α = 2 / (n + 1). One value per input.
 */
export function ema(values: readonly number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const out: number[] = [];
  let m = values[0] ?? 0;
  for (const v of values) {
    m = alpha * v + (1 - alpha) * m;
    out.push(m);
  }
  return out;
}

interface Bar {
  high: number;
  low: number;
  close: number;
}

/**
 * ATR as the reference computes it: true range of the first candle is 0,
 * then TR = max(high, prev close) − min(low, prev close); the average starts
 * at 0 and moves by (TR − ATR) / period each candle (Wilder smoothing).
 * One value per input candle; after a few hundred candles the start no
 * longer matters.
 */
export function atr(candles: readonly Bar[], period: number): number[] {
  const out: number[] = [];
  let a = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i] as Bar;
    const prev = candles[i - 1];
    const tr = prev ? Math.max(c.high, prev.close) - Math.min(c.low, prev.close) : 0;
    a += (tr - a) / period;
    out.push(a);
  }
  return out;
}
