import type { Candle } from "@/lib/types";
import type { Trend } from "../types";
import { findSwings } from "./swings";

/**
 * Trend from the last two swing highs and last two swing lows:
 * higher high + higher low = UP; lower high + lower low = DOWN;
 * anything else (or fewer than two of each) = RANGE.
 */
export function getTrend(candles: readonly Candle[], strength: number): Trend {
  const { highs, lows } = findSwings(candles, strength);
  const [prevHigh, lastHigh] = highs.slice(-2);
  const [prevLow, lastLow] = lows.slice(-2);
  if (!prevHigh || !lastHigh || !prevLow || !lastLow) return "RANGE";

  if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) return "UP";
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price) return "DOWN";
  return "RANGE";
}
