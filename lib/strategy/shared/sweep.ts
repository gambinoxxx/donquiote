import type { Candle, Direction, Pair } from "@/lib/types";
import { TIMEFRAME_MS } from "@/lib/market/time";
import { SWEEP_SIDE, type OpenSetup, type StrategySettings, type Trend } from "../types";
import type { LiquidityLevel } from "./liquidity";
import { findSwings } from "./swings";

const MINUTE_MS = 60_000;

export function sweepDedupeKey(pair: Pair, direction: Direction, sweepTime: string): string {
  return `${pair}:${direction}:${sweepTime}`;
}

/** Direction allowed by the higher timeframes: D and H4 must agree. */
export function tradeDirection(trendD: Trend, trendH4: Trend): Direction | null {
  if (trendD === "DOWN" && trendH4 === "DOWN") return "SELL";
  if (trendD === "UP" && trendH4 === "UP") return "BUY";
  return null;
}

export interface DetectSweepInput {
  pair: Pair;
  trendD: Trend;
  trendH4: Trend;
  /** Levels built from the candles before `candle`. */
  levels: readonly LiquidityLevel[];
  /** Closed M15 candles before `candle`, oldest first. */
  history: readonly Candle[];
  /** The closed M15 candle being evaluated. */
  candle: Candle;
  settings: Pick<StrategySettings, "swingStrength" | "watchExpiryMinutes">;
}

/** True if no candle since `level.since` already traded through the level. */
function isUntouched(
  level: LiquidityLevel,
  direction: Direction,
  history: readonly Candle[],
): boolean {
  return !history.some(
    (c) =>
      c.time >= level.since &&
      (direction === "SELL" ? c.high > level.price : c.low < level.price),
  );
}

/**
 * A new sweep on `candle`, or null.
 * - D and H4 both DOWN: the candle's high trades above an untouched high
 *   level (PDH, EQH, ASH, …) → SELL
 * - D and H4 both UP: the candle's low trades below an untouched low
 *   level (PDL, EQL, ASL, …) → BUY
 * If several levels are swept, the furthest one (highest for SELL, lowest
 * for BUY) is used. The BOS level is the last confirmed M15 swing low
 * (SELL) / high (BUY) before the sweep candle; no swing → no setup.
 * The caller enforces one WATCHING setup per pair and direction.
 */
export function detectSweep(input: DetectSweepInput): OpenSetup | null {
  const { pair, levels, history, candle, settings } = input;
  const direction = tradeDirection(input.trendD, input.trendH4);
  if (!direction) return null;

  // SELL setups sweep highs (PDH, EQH, …); BUY setups sweep lows.
  const side = direction === "SELL" ? "HIGH" : "LOW";
  const swept = levels
    .filter((level) => SWEEP_SIDE[level.type] === side)
    .filter((level) =>
      direction === "SELL" ? candle.high > level.price : candle.low < level.price,
    )
    .filter((level) => isUntouched(level, direction, history))
    .sort((a, b) => (direction === "SELL" ? b.price - a.price : a.price - b.price));
  const level = swept[0];
  if (!level) return null;

  const swings = findSwings(history, settings.swingStrength);
  const bosSwing = (direction === "SELL" ? swings.lows : swings.highs).at(-1);
  if (!bosSwing) return null;

  const closeMs = Date.parse(candle.time) + TIMEFRAME_MS.M15;
  return {
    dedupeKey: sweepDedupeKey(pair, direction, candle.time),
    direction,
    sweepType: level.type,
    sweepLevel: level.price,
    sweepExtreme: direction === "SELL" ? candle.high : candle.low,
    sweepTime: candle.time,
    bosLevel: bosSwing.price,
    expiresAt: new Date(closeMs + settings.watchExpiryMinutes * MINUTE_MS).toISOString(),
  };
}

/** True if `candle` pushes further past the setup's sweep extreme. */
export function extendsSweep(setup: OpenSetup, candle: Candle): boolean {
  return setup.direction === "SELL"
    ? candle.high > setup.sweepExtreme
    : candle.low < setup.sweepExtreme;
}
