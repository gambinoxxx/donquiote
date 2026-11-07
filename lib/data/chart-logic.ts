// Pure chart helpers: candle limits, closed-candle cutoff, and the overlay
// levels computed with the scanner's own functions (lib/strategy), so the
// chart and the scanner always agree. No I/O.
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { forexDayOpen, TIMEFRAME_MS } from "@/lib/market/time";
import { pipSize } from "@/lib/market/pip";
import { getV2LiquidityLevels } from "@/lib/strategy/dg-v2-candidate/levels";
import { getLiquidityLevels } from "@/lib/strategy/shared/liquidity";
import { getTrend } from "@/lib/strategy/shared/trend";
import type { StrategySettings, Trend } from "@/lib/strategy/types";

export const CHART_TIMEFRAMES: readonly Timeframe[] = ["D", "H4", "M15"];
export const DEFAULT_CANDLE_LIMIT = 500;
export const MAX_CANDLE_LIMIT = 1000;
/** Candles the levels are computed from (the scanner's windows, lib/strategy/replay.ts). */
export const LEVEL_WINDOWS: Record<Timeframe, number> = { D: 150, H4: 300, M15: 500 };

export type LevelKind = "PDH" | "PDL" | "ASH" | "ASL" | "EQH" | "EQL";

export interface ChartLevel {
  kind: LevelKind;
  price: number;
  /** ISO: from when the level counts (EQH/EQL: the group's first swing). */
  since: string;
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_CANDLE_LIMIT;
  return Math.max(1, Math.min(MAX_CANDLE_LIMIT, Math.floor(limit)));
}

/** Latest open time (ISO) of a candle of this timeframe that has closed by `now`. */
export function latestClosedOpen(timeframe: Timeframe, now: Date): string {
  return new Date(now.getTime() - TIMEFRAME_MS[timeframe]).toISOString();
}

/** Keeps closed candles only, oldest first (defensive: the worker stores only closed ones). */
export function closedOnly<T extends { time: string }>(candles: readonly T[], timeframe: Timeframe, now: Date): T[] {
  const cutoff = latestClosedOpen(timeframe, now);
  return candles.filter((c) => c.time <= cutoff).sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * The overlay levels as the scanner will see them at its next candle (all
 * closed candles so far are history): dg-v1's previous day high/low and
 * equal highs/lows (getLiquidityLevels on the closed D and M15 candles), the
 * Asian session high/low as dg-v2-candidate defines it (forex-day open →
 * 07:00 UTC; only once that session has ended, so none over the weekend
 * until Monday 07:00 UTC), and the D and 4H trend (getTrend). Same
 * functions, same candles.
 */
export function computeChartLevels(args: {
  pair: Pair;
  D: readonly Candle[];
  H4: readonly Candle[];
  M15: readonly Candle[];
  settings: Pick<StrategySettings, "swingStrength" | "equalTolerancePips">;
}): { levels: ChartLevel[]; trendD: Trend; trendH4: Trend } {
  const { pair, D, H4, M15, settings } = args;
  const levels: ChartLevel[] = getLiquidityLevels({ pair, candles: { D, M15 }, settings }).map((l) => ({
    kind: l.type as LevelKind,
    price: l.price,
    since: l.since,
  }));
  const last = M15.at(-1);
  if (last) {
    // The scanner's next candle opens when this one closes.
    const next: Candle = { ...last, time: new Date(Date.parse(last.time) + TIMEFRAME_MS.M15).toISOString() };
    for (const l of getV2LiquidityLevels({ pair, D, history: M15, candle: next, settings })) {
      if (l.type === "ASH" || l.type === "ASL") levels.push({ kind: l.type, price: l.price, since: l.since });
    }
  }
  return {
    levels,
    trendD: getTrend(D, settings.swingStrength),
    trendH4: getTrend(H4, settings.swingStrength),
  };
}

/**
 * Change since the forex-day open (first M15 candle at or after 17:00 New
 * York) of the day the last closed candle belongs to — so at the weekend it
 * shows Friday's change.
 */
export function dayChange(
  pair: Pair,
  m15: readonly Candle[],
): { openPrice: number; change: number; changePips: number; changePct: number } | null {
  const last = m15.at(-1);
  if (!last) return null;
  const dayOpen = forexDayOpen(new Date(last.time)).toISOString();
  const first = m15.find((c) => c.time >= dayOpen);
  if (!first) return null;
  const change = last.close - first.open;
  return {
    openPrice: first.open,
    change,
    changePips: Math.round((change / pipSize(pair)) * 10) / 10,
    changePct: Math.round((change / first.open) * 10000) / 100,
  };
}
