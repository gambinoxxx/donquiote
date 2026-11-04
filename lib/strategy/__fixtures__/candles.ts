// Hand-built candle fixtures for strategy tests. Test-only.
import type { Candle, Pair } from "@/lib/types";
import { applyEvents } from "../apply-events";
import type { OpenSetup, SetupEvent, Strategy, StrategySettings } from "../types";

export const M15_MS = 15 * 60_000;
const H4_MS = 4 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

export const SETTINGS: StrategySettings = {
  accountSizeUsd: 10_000,
  riskPct: 0.5,
  rewardRatio: 3,
  stopBufferPips: 3,
  watchExpiryMinutes: 120,
  swingStrength: 2,
  equalTolerancePips: 2,
};

const round = (n: number, decimals: number) => Number(n.toFixed(decimals));

/** Candles with open = close = value and high/low = value ± halfRange. */
export function waveCandles(
  values: readonly number[],
  halfRange: number,
  startIso: string,
  stepMs: number,
  decimals = 5,
): Candle[] {
  const start = Date.parse(startIso);
  return values.map((v, i) => ({
    time: new Date(start + i * stepMs).toISOString(),
    open: v,
    high: round(v + halfRange, decimals),
    low: round(v - halfRange, decimals),
    close: v,
  }));
}

/** M15 candles from [open, high, low, close] rows, 15 minutes apart. */
export function m15(startIso: string, rows: ReadonlyArray<readonly [number, number, number, number]>): Candle[] {
  const start = Date.parse(startIso);
  return rows.map(([open, high, low, close], i) => ({
    time: new Date(start + i * M15_MS).toISOString(),
    open,
    high,
    low,
    close,
  }));
}

// Two lower highs (1.1220, 1.1170) and two lower lows (1.0980, 1.0930) at
// strength 2. The last value (1.1050) is the previous day: PDH 1.1070, PDL 1.1030.
export const EUR_DOWN = [
  1.11, 1.115, 1.12, 1.115, 1.11, 1.105, 1.1, 1.105, 1.11, 1.115, 1.11, 1.105, 1.1, 1.095, 1.1,
  1.105,
];
export const EUR_UP = EUR_DOWN.map((v) => round(2 * 1.105 - v, 5));
export const EUR_HALF_RANGE = 0.002;

// JPY uptrend: higher highs (157.20, 157.70), higher lows (154.80, 155.30).
// Previous day 156.50: PDH 156.70, PDL 156.30.
export const JPY_UP = [
  156, 155.5, 155, 155.5, 156, 156.5, 157, 156.5, 156, 155.5, 156, 156.5, 157, 157.5, 157, 156.5,
];
export const JPY_HALF_RANGE = 0.2;

/** The previous forex day is the last D candle (Mon 2 Nov 17:00 EST). */
export const D_START = "2026-10-18T22:00:00.000Z";
/** H4 candles end at Tue 3 Nov 13:00 EST. */
export const H4_START = "2026-11-01T06:00:00.000Z";
/** Current forex day: Tue 3 Nov 17:00 EST. */
export const M15_START = "2026-11-03T22:00:00.000Z";

export function daily(values: readonly number[], halfRange: number, decimals = 5): Candle[] {
  return waveCandles(values, halfRange, D_START, DAY_MS, decimals);
}

export function h4(values: readonly number[], halfRange: number, decimals = 5): Candle[] {
  return waveCandles(values, halfRange, H4_START, H4_MS, decimals);
}

export interface ReplayStep {
  index: number;
  time: string;
  events: SetupEvent[];
}

/**
 * Runs `strategy.evaluate` once per M15 candle (as the worker would after
 * each close), threading the open setups through `applyEvents`.
 */
export function replay(
  strategy: Strategy,
  args: {
    pair: Pair;
    D: readonly Candle[];
    H4: readonly Candle[];
    M15: readonly Candle[];
    settings?: StrategySettings;
  },
): { steps: ReplayStep[]; events: SetupEvent[]; openSetups: OpenSetup[] } {
  let openSetups: OpenSetup[] = [];
  const steps: ReplayStep[] = [];
  for (let i = 0; i < args.M15.length; i++) {
    const candle = args.M15[i];
    if (!candle) continue;
    const events = strategy.evaluate({
      pair: args.pair,
      now: new Date(Date.parse(candle.time) + M15_MS),
      candles: { D: args.D, H4: args.H4, M15: args.M15.slice(0, i + 1) },
      settings: args.settings ?? SETTINGS,
      openSetups,
    });
    openSetups = applyEvents(openSetups, events);
    if (events.length > 0) steps.push({ index: i, time: candle.time, events });
  }
  return { steps, events: steps.flatMap((s) => s.events), openSetups };
}
