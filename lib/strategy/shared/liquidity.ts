import type { Candle, Pair } from "@/lib/types";
import { pipSize } from "@/lib/market/pip";
import type { StrategySettings, SweepType } from "../types";
import { findSwings, type SwingPoint } from "./swings";

/** Float tolerance for price comparisons made in pips. */
const PRICE_EPSILON = 1e-9;

export interface LiquidityLevel {
  type: SweepType;
  price: number;
  /**
   * ISO time from which the level counts as untouched liquidity: the
   * previous forex day's open for PDH/PDL, the first swing of the group for
   * EQH/EQL. A sweep must be the first candle since then to trade through.
   */
  since: string;
}

export interface LiquidityInput {
  pair: Pair;
  candles: { D: readonly Candle[]; M15: readonly Candle[] };
  settings: Pick<StrategySettings, "swingStrength" | "equalTolerancePips">;
}

/**
 * Groups swing prices so every member is within `tolerance` of every other
 * (sorted by price; a group spans at most `tolerance`). Groups of 2+ only.
 */
function groupEqual(points: readonly SwingPoint[], tolerance: number): SwingPoint[][] {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const groups: SwingPoint[][] = [];
  let current: SwingPoint[] = [];
  for (const point of sorted) {
    const first = current[0];
    if (first && point.price - first.price <= tolerance + PRICE_EPSILON) {
      current.push(point);
    } else {
      if (current.length >= 2) groups.push(current);
      current = [point];
    }
  }
  if (current.length >= 2) groups.push(current);
  return groups;
}

function earliestTime(points: readonly SwingPoint[]): string {
  return points.reduce((min, p) => (p.time < min ? p.time : min), points[0]?.time ?? "");
}

/**
 * Liquidity levels from the candles passed in:
 * - PDH / PDL: high and low of the last closed daily candle
 * - EQH / EQL: 2+ M15 swing highs (lows) within `equalTolerancePips` of
 *   each other, inside the current and previous forex day (from the last
 *   closed daily candle's open onward); the level is the group's highest
 *   high (lowest low).
 */
export function getLiquidityLevels(input: LiquidityInput): LiquidityLevel[] {
  const { pair, candles, settings } = input;
  const previousDay = candles.D.at(-1);
  if (!previousDay) return [];

  const levels: LiquidityLevel[] = [
    { type: "PDH", price: previousDay.high, since: previousDay.time },
    { type: "PDL", price: previousDay.low, since: previousDay.time },
  ];

  const windowStart = previousDay.time;
  const swings = findSwings(candles.M15, settings.swingStrength);
  const tolerance = settings.equalTolerancePips * pipSize(pair);
  const inWindow = (p: SwingPoint) => p.time >= windowStart;

  for (const group of groupEqual(swings.highs.filter(inWindow), tolerance)) {
    levels.push({
      type: "EQH",
      price: Math.max(...group.map((p) => p.price)),
      since: earliestTime(group),
    });
  }
  for (const group of groupEqual(swings.lows.filter(inWindow), tolerance)) {
    levels.push({
      type: "EQL",
      price: Math.min(...group.map((p) => p.price)),
      since: earliestTime(group),
    });
  }
  return levels;
}
