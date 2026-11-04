import type { Candle } from "@/lib/types";
import { TIMEFRAME_MS } from "@/lib/market/time";
import type { OpenSetup } from "../types";

export type BosOutcome = "CONFIRM" | "EXPIRE" | null;

/**
 * What a later closed M15 candle means for an open setup:
 * - EXPIRE if the candle closes after `expiresAt` (checked first)
 * - CONFIRM if its close is beyond the BOS level (below for SELL, above for
 *   BUY); a wick through the level without a close beyond does not count
 * - otherwise null (still watching)
 * The sweep candle itself never confirms its own setup.
 */
export function detectBos(setup: OpenSetup, candle: Candle): BosOutcome {
  if (candle.time <= setup.sweepTime) return null;
  const closeMs = Date.parse(candle.time) + TIMEFRAME_MS.M15;
  if (closeMs > Date.parse(setup.expiresAt)) return "EXPIRE";
  const beyond =
    setup.direction === "SELL"
      ? candle.close < setup.bosLevel
      : candle.close > setup.bosLevel;
  return beyond ? "CONFIRM" : null;
}
