// dg-v2-candidate liquidity: previous day high/low, Asian session high/low,
// and 1H equal highs/lows. No M15 equal highs/lows.
// Reference: doc/reference/v2.py, option A.
import type { Candle, Pair } from "@/lib/types";
import { pipSize } from "@/lib/market/pip";
import { forexDayOpen } from "@/lib/market/time";
import { toHourly } from "../shared/hourly";
import { earliestTime, groupEqual, type LiquidityLevel } from "../shared/liquidity";
import { findSwings, type SwingPoint } from "../shared/swings";
import type { StrategySettings } from "../types";

/** The Asian session ends at 07:00 UTC; it starts at the forex-day open (17:00 New York). */
export const ASIAN_SESSION_END_HOUR_UTC = 7;

const DAY_MS = 24 * 3_600_000;

/**
 * End of the Asian session of the forex day that contains `candleTime`:
 * 07:00 UTC on the candle's calendar day, or the next day's 07:00 if that
 * is not after the forex-day open (e.g. a 23:00 UTC candle).
 */
export function asianSessionEnd(candleTime: string, dayOpen: string): string {
  const t = new Date(candleTime);
  let end = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), ASIAN_SESSION_END_HOUR_UTC);
  if (end <= Date.parse(dayOpen)) end += DAY_MS;
  return new Date(end).toISOString();
}

export interface V2LevelsInput {
  pair: Pair;
  /** Closed daily candles; the last one is the previous forex day. */
  D: readonly Candle[];
  /** Closed M15 candles before `candle`, oldest first. */
  history: readonly Candle[];
  /** The M15 candle being evaluated. */
  candle: Candle;
  settings: Pick<StrategySettings, "swingStrength" | "equalTolerancePips">;
}

/**
 * - PDH / PDL: high and low of the last closed daily candle
 * - ASH / ASL: high and low of the M15 candles from the forex-day open to
 *   07:00 UTC; only once the session has ended (the candle opens at or
 *   after 07:00). Untouched from 07:00 onward.
 * - EQH / EQL: 2+ confirmed 1H swing highs (lows) within the equal
 *   tolerance, inside the current and previous forex day, grouped the same
 *   way as dg-v1's M15 ones. 1H candles are built from the M15 candles and
 *   only count once the hour has closed.
 */
export function getV2LiquidityLevels(input: V2LevelsInput): LiquidityLevel[] {
  const { pair, D, history, candle, settings } = input;
  const previousDay = D.at(-1);
  if (!previousDay) return [];

  const levels: LiquidityLevel[] = [
    { type: "PDH", price: previousDay.high, since: previousDay.time },
    { type: "PDL", price: previousDay.low, since: previousDay.time },
  ];

  const dayOpen = forexDayOpen(new Date(candle.time)).toISOString();
  const asiaEnd = asianSessionEnd(candle.time, dayOpen);
  if (candle.time >= asiaEnd) {
    const session = history.filter((c) => c.time >= dayOpen && c.time < asiaEnd);
    if (session.length > 0) {
      levels.push(
        { type: "ASH", price: Math.max(...session.map((c) => c.high)), since: asiaEnd },
        { type: "ASL", price: Math.min(...session.map((c) => c.low)), since: asiaEnd },
      );
    }
  }

  const hourly = toHourly(history, candle.time);
  const swings = findSwings(hourly, settings.swingStrength);
  const tolerance = settings.equalTolerancePips * pipSize(pair);
  const inWindow = (p: SwingPoint) => p.time >= previousDay.time;
  for (const group of groupEqual(swings.highs.filter(inWindow), tolerance)) {
    levels.push({ type: "EQH", price: Math.max(...group.map((p) => p.price)), since: earliestTime(group) });
  }
  for (const group of groupEqual(swings.lows.filter(inWindow), tolerance)) {
    levels.push({ type: "EQL", price: Math.min(...group.map((p) => p.price)), since: earliestTime(group) });
  }
  return levels;
}
