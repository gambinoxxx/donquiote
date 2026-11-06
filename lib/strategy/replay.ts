// Pure helpers that build a strategy's input "as of" a candle close. Shared
// by the backtester and the live worker so both feed the strategy exactly
// the same candles (architecture invariant 3).
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { TIMEFRAME_MS } from "@/lib/market/time";
import type { OpenSetup, StrategyInput, StrategySettings } from "./types";

/**
 * Rolling windows passed to the strategy each step. 500 M15 candles is
 * about 2.5 forex days — more than dg-v1 reads (equal highs/lows look back
 * two forex days; the BOS level is the latest swing). On the Jan–Nov 2026
 * data, 500 gives byte-identical backtest results to 2000, ~3× faster.
 */
export const STRATEGY_WINDOWS: Record<Timeframe, number> = { D: 150, H4: 300, M15: 500 };

/** Close time (ms) of a candle. Candles in trading hours have fixed lengths. */
export function candleCloseMs(candle: Candle, timeframe: Timeframe): number {
  return Date.parse(candle.time) + TIMEFRAME_MS[timeframe];
}

/**
 * How many candles (from the start of a sorted array) have closed by `tMs`.
 * Binary search on canonical ISO strings (see Candle.time): a candle has
 * closed by t if it opened at or before t − its duration.
 */
export function countClosedBy(candles: readonly Candle[], timeframe: Timeframe, tMs: number): number {
  const latestAllowedOpen = new Date(tMs - TIMEFRAME_MS[timeframe]).toISOString();
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((candles[mid] as Candle).time <= latestAllowedOpen) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Throws if any candle passed to the strategy had not closed by `tMs`.
 * Checks every candle with cheap string comparisons.
 */
export function assertNoLookAhead(input: StrategyInput, tMs: number): void {
  for (const timeframe of ["D", "H4", "M15"] as const) {
    const latestAllowedOpen = new Date(tMs - TIMEFRAME_MS[timeframe]).toISOString();
    for (const candle of input.candles[timeframe]) {
      if (candle.time > latestAllowedOpen) {
        throw new Error(
          `Look-ahead: ${timeframe} candle ${candle.time} closes after ${new Date(tMs).toISOString()}`,
        );
      }
    }
  }
}

export interface InputAtArgs {
  pair: Pair;
  /** All available candles per timeframe, sorted oldest first. */
  candles: { D: readonly Candle[]; H4: readonly Candle[]; M15: readonly Candle[] };
  /** Index in `candles.M15` of the candle being evaluated. */
  m15Index: number;
  settings: StrategySettings;
  openSetups: readonly OpenSetup[];
  windows?: Record<Timeframe, number>;
}

/**
 * StrategyInput as of the close of `candles.M15[m15Index]`: only candles
 * that closed by then, in rolling windows. Guards against look-ahead.
 */
export function buildInputAt(args: InputAtArgs): { input: StrategyInput; tMs: number } {
  const { pair, candles, m15Index, settings, openSetups } = args;
  const windows = args.windows ?? STRATEGY_WINDOWS;
  const candle = candles.M15[m15Index];
  if (!candle) throw new RangeError(`No M15 candle at index ${m15Index}`);
  const tMs = candleCloseMs(candle, "M15");
  const dEnd = countClosedBy(candles.D, "D", tMs);
  const h4End = countClosedBy(candles.H4, "H4", tMs);
  const input: StrategyInput = {
    pair,
    now: new Date(tMs),
    candles: {
      D: candles.D.slice(Math.max(0, dEnd - windows.D), dEnd),
      H4: candles.H4.slice(Math.max(0, h4End - windows.H4), h4End),
      M15: candles.M15.slice(Math.max(0, m15Index + 1 - windows.M15), m15Index + 1),
    },
    settings,
    openSetups,
  };
  assertNoLookAhead(input, tMs);
  return { input, tMs };
}
