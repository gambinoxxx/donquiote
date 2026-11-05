// Pure paper-trade resolver. Used by the backtester now and by the live
// worker later, so a paper trade is judged the same way in both.
import type { Candle, Direction, Pair } from "@/lib/types";
import { TIMEFRAME_MS } from "@/lib/market/time";

/** 72 hours of market time in M15 candles (weekends have no candles). */
export const PAPER_TIMEOUT_CANDLES = 288;

export interface PaperTrade {
  pair: Pair;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  riskUsd: number;
  /** ISO, UTC: close time of the confirming candle. */
  openedAt: string;
}

export type PaperStatus = "OPEN" | "WIN" | "LOSS" | "UNRESOLVED";

export interface PaperResult {
  status: PaperStatus;
  exitPrice?: number;
  /** ISO, UTC: close time of the candle that resolved the trade. */
  closedAt?: string;
  resultR?: number;
  pnlUsd?: number;
  note?: string;
}

export const NOTE_SAME_CANDLE = "stop and target in same candle";
export const NOTE_GAPPED_STOP = "gapped through stop";
export const NOTE_GAPPED_TARGET = "gapped through target";
export const NOTE_TIMEOUT = "no result within the timeout";

const round2 = (n: number) => Math.round(n * 100) / 100;

function candleCloseIso(candle: Candle): string {
  return new Date(Date.parse(candle.time) + TIMEFRAME_MS.M15).toISOString();
}

function closeTrade(
  trade: PaperTrade,
  status: Exclude<PaperStatus, "OPEN">,
  exitPrice: number,
  candle: Candle,
  note?: string,
): PaperResult {
  const stopDistance = Math.abs(trade.entry - trade.stop);
  const sign = trade.direction === "BUY" ? 1 : -1;
  const resultR = round2((sign * (exitPrice - trade.entry)) / stopDistance);
  return {
    status,
    exitPrice,
    closedAt: candleCloseIso(candle),
    resultR,
    pnlUsd: round2(resultR * trade.riskUsd),
    ...(note ? { note } : {}),
  };
}

/**
 * Walks closed M15 candles that come **after** the entry candle, oldest
 * first:
 * - stop hit → LOSS at the stop; target hit → WIN at the target
 * - stop and target inside the same candle → LOSS (we can't know the order)
 * - candle opens beyond the stop → LOSS at the open (can be worse than −1R)
 * - candle opens beyond the target → WIN at the target (no bonus)
 * - nothing after `timeoutCandles` candles → UNRESOLVED at the last close
 * - otherwise OPEN
 */
export function resolvePaperTrade(
  trade: PaperTrade,
  candles: readonly Candle[],
  timeoutCandles: number = PAPER_TIMEOUT_CANDLES,
): PaperResult {
  if (Math.abs(trade.entry - trade.stop) === 0) {
    throw new RangeError("Paper trade has no stop distance");
  }
  const sell = trade.direction === "SELL";
  const beyondStop = (price: number) => (sell ? price >= trade.stop : price <= trade.stop);
  const beyondTarget = (price: number) => (sell ? price <= trade.target : price >= trade.target);

  const limit = Math.min(candles.length, timeoutCandles);
  for (let i = 0; i < limit; i++) {
    const candle = candles[i];
    if (!candle) continue;

    if (beyondStop(candle.open)) {
      return closeTrade(trade, "LOSS", candle.open, candle, NOTE_GAPPED_STOP);
    }
    if (beyondTarget(candle.open)) {
      return closeTrade(trade, "WIN", trade.target, candle, NOTE_GAPPED_TARGET);
    }
    const hitStop = beyondStop(sell ? candle.high : candle.low);
    const hitTarget = beyondTarget(sell ? candle.low : candle.high);
    if (hitStop && hitTarget) {
      return closeTrade(trade, "LOSS", trade.stop, candle, NOTE_SAME_CANDLE);
    }
    if (hitStop) return closeTrade(trade, "LOSS", trade.stop, candle);
    if (hitTarget) return closeTrade(trade, "WIN", trade.target, candle);
  }

  const last = candles[timeoutCandles - 1];
  if (candles.length >= timeoutCandles && last) {
    return closeTrade(trade, "UNRESOLVED", last.close, last, NOTE_TIMEOUT);
  }
  return { status: "OPEN" };
}
