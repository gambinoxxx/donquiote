import type { Candle } from "@/lib/types";

const HOUR_MS = 3_600_000;

/**
 * Longest normal gap between consecutive candle opens: the weekend close
 * (Friday 17:00 → Sunday 17:00 NY, 48h, or 49h when the clocks go back over
 * the weekend) plus one candle.
 */
export function normalWeekendGapMs(timeframeMs: number): number {
  return 49 * HOUR_MS + timeframeMs;
}

export interface Gap {
  after: string;
  next: string;
  hours: number;
}

/** Gaps between consecutive candles longer than a normal weekend. */
export function findLongGaps(candles: readonly Candle[], timeframeMs: number): Gap[] {
  const limit = normalWeekendGapMs(timeframeMs);
  const gaps: Gap[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const next = candles[i];
    if (!prev || !next) continue;
    const ms = Date.parse(next.time) - Date.parse(prev.time);
    if (ms > limit) gaps.push({ after: prev.time, next: next.time, hours: ms / HOUR_MS });
  }
  return gaps;
}
