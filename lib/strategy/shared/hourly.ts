import type { Candle } from "@/lib/types";

const HOUR_MS = 3_600_000;

/**
 * 1H candles built from M15 candles (oldest first): each UTC hour's
 * candles merged (first open, highest high, lowest low, last close). Only
 * hours that have ended by `closedBy` (ISO) are returned, so the last one is
 * never still forming. Hours with missing M15 candles (market gaps) are
 * built from what exists.
 */
export function toHourly(m15: readonly Candle[], closedBy: string): Candle[] {
  const latestOpen = new Date(Date.parse(closedBy) - HOUR_MS).toISOString();
  const hours: Candle[] = [];
  let current: Candle | null = null;
  for (const candle of m15) {
    const hour = `${candle.time.slice(0, 13)}:00:00.000Z`;
    if (hour > latestOpen) break;
    if (current && current.time === hour) {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
    } else {
      if (current) hours.push(current);
      current = { time: hour, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
    }
  }
  if (current) hours.push(current);
  return hours;
}
