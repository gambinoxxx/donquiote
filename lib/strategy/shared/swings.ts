import type { Candle } from "@/lib/types";

export interface SwingPoint {
  /** Index in the candle array passed in. */
  index: number;
  /** Open time of the swing candle (ISO). */
  time: string;
  price: number;
}

export interface Swings {
  highs: SwingPoint[];
  lows: SwingPoint[];
}

/**
 * Confirmed swing points, oldest first. A swing high's high is strictly
 * greater than the highs of `strength` candles on each side (ties are not
 * swings); swing lows mirror this. A swing only counts once `strength`
 * closed candles exist after it.
 */
export function findSwings(candles: readonly Candle[], strength: number): Swings {
  if (!Number.isInteger(strength) || strength < 1) {
    throw new RangeError("swing strength must be a positive integer");
  }
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let i = strength; i < candles.length - strength; i++) {
    const candle = candles[i];
    if (!candle) continue;
    let isHigh = true;
    let isLow = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      const other = candles[j];
      if (!other) continue;
      if (!(candle.high > other.high)) isHigh = false;
      if (!(candle.low < other.low)) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ index: i, time: candle.time, price: candle.high });
    if (isLow) lows.push({ index: i, time: candle.time, price: candle.low });
  }
  return { highs, lows };
}
