// London Breakout (london-break). Rules: project-overview.md → Registered
// strategies. Fixed before testing; not tuned to the backtest.
//
// 1. Asian range: high and low of the M15 candles from 00:00 to 07:00 UTC on
//    the breakout candle's UTC day. Skip the day if it is under 15 or over
//    60 pips.
// 2. Direction filter: buys only if the last closed 4H close is above the
//    EMA50 of closed 4H candles; sells only if below (gemini-fvg's EMA).
// 3. Breakout window: candles opening 07:00–10:00 UTC (closing by 10:00).
// 4. Breakout candle: the first candle in the window whose body closes at
//    least 1 pip beyond the Asian high (buy) or low (sell), with a body of at
//    least 50% of its range and at least 1 × ATR14 (M15, gemini-fvg's ATR, as
//    of the candle before). Only the first qualifying breakout of the day
//    counts: if it is against the filter, skipped for news or has a stop out
//    of range, there is no trade that day.
// 5. Entry: market at the breakout candle's close → READY at once (SWEEP and
//    CONFIRM on the same candle, committed together; never seen as Watching).
// 6. Stop: 2 pips beyond the breakout candle's other end; it must be 8–30
//    pips, otherwise skipped.
// 7. Target 1.5R.
// 8. Time exit: still open at 16:00 UTC that day → Unresolved at that
//    candle's close (lib/paper/, Strategy.exitAtUtcHour).
// 9. At most one trade per pair per forex day.
// 10. News: skipped if a stored red calendar event for either currency is
//     within 30 minutes of the breakout candle's close (StrategyInput.redNews;
//     the backtest has no news history, so the rule does not apply there).
//
// DO NOT CHANGE RULES HERE once this strategy has produced alerts — copy it
// to a new id (architecture invariant 11).
import type { Candle, Direction, Pair } from "@/lib/types";
import { pipSize, priceDecimals } from "@/lib/market/pip";
import { forexDayOpen, TIMEFRAME_MS } from "@/lib/market/time";
import { atr, ema } from "../gemini-fvg/indicators";
import { sweepDedupeKey } from "../shared/sweep";
import { buildTradeTicket } from "../shared/ticket";
import type { RedNewsEvent, SetupEvent, Strategy, StrategyInput } from "../types";

/** Asian range, UTC hours [from, to) of the breakout candle's day (candle open time). */
export const ASIAN_RANGE_UTC: readonly [number, number] = [0, 7];
export const MIN_RANGE_PIPS = 15;
export const MAX_RANGE_PIPS = 60;
export const EMA_PERIOD_H4 = 50;
/** Breakout window, UTC hours [from, to) by candle open time. */
export const BREAKOUT_WINDOW_UTC: readonly [number, number] = [7, 10];
/** The breakout close must be at least this far beyond the Asian high/low. */
export const BREAKOUT_CLOSE_PIPS = 1;
/** Body ≥ this share of the candle's high–low range. */
export const MIN_BODY_TO_RANGE = 0.5;
export const ATR_PERIOD = 14;
/** Body ≥ this × ATR14. */
export const MIN_BODY_ATR_MULTIPLE = 1;
export const STOP_BUFFER_PIPS = 2;
export const MIN_STOP_PIPS = 8;
export const MAX_STOP_PIPS = 30;
export const REWARD_RATIO = 1.5;
/** Paper trades still open at this UTC hour close as Unresolved. */
export const EXIT_AT_UTC_HOUR = 16;
export const MAX_TRADES_PER_FOREX_DAY = 1;
/** Skip a breakout with red news this close (either side) to its candle's close. */
export const NEWS_WINDOW_MINUTES = 30;

const M15_MS = TIMEFRAME_MS.M15;
const HOUR_MS = 3_600_000;
const REACHED_READY = new Set(["READY", "TAKEN", "SKIPPED"]);

const utcDayStart = (iso: string) => {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const atHour = (dayStartMs: number, hour: number) => new Date(dayStartMs + hour * HOUR_MS).toISOString();
const roundTo = (n: number, decimals: number) => Number(n.toFixed(decimals));

export function inBreakoutWindow(candleTime: string): boolean {
  const hour = new Date(candleTime).getUTCHours();
  return hour >= BREAKOUT_WINDOW_UTC[0] && hour < BREAKOUT_WINDOW_UTC[1];
}

export interface AsianRange {
  high: number;
  low: number;
  pips: number;
}

/** The Asian range on `candleTime`'s UTC day, or null if no candles (oldest first). */
export function asianRange(m15: readonly Candle[], candleTime: string, pair: Pair): AsianRange | null {
  const day = utcDayStart(candleTime);
  const from = atHour(day, ASIAN_RANGE_UTC[0]);
  const to = atHour(day, ASIAN_RANGE_UTC[1]);
  const asia = m15.filter((c) => c.time >= from && c.time < to);
  if (asia.length === 0) return null;
  const high = Math.max(...asia.map((c) => c.high));
  const low = Math.min(...asia.map((c) => c.low));
  return { high, low, pips: roundTo((high - low) / pipSize(pair), 1) };
}

export function rangeAllowed(range: AsianRange): boolean {
  return range.pips >= MIN_RANGE_PIPS && range.pips <= MAX_RANGE_PIPS;
}

/** The direction this candle breaks out in, or null if it doesn't qualify. */
export function breakoutDirection(
  candle: Candle,
  range: AsianRange,
  atrBefore: number,
  pip: number,
): Direction | null {
  const body = Math.abs(candle.close - candle.open);
  const spread = candle.high - candle.low;
  if (!(body >= MIN_BODY_TO_RANGE * spread) || !(body >= MIN_BODY_ATR_MULTIPLE * atrBefore) || body === 0) return null;
  // Tolerate float noise in "at least 1 pip" (prices have 5 or 3 decimals).
  const minMove = BREAKOUT_CLOSE_PIPS * pip - 1e-9;
  if (candle.close > candle.open && candle.close - range.high >= minMove) return "BUY";
  if (candle.close < candle.open && range.low - candle.close >= minMove) return "SELL";
  return null;
}

/** BUY / SELL allowed by the last closed 4H close against the EMA50, or null. */
export function filterDirection(h4: readonly Candle[]): Direction | null {
  if (h4.length <= EMA_PERIOD_H4) return null;
  const closes = h4.map((c) => c.close);
  const emaH4 = ema(closes, EMA_PERIOD_H4).at(-1) as number;
  const last = closes.at(-1) as number;
  if (last > emaH4) return "BUY";
  if (last < emaH4) return "SELL";
  return null;
}

/** A red event on either currency of the pair within the news window of `atIso`. */
export function redNewsNear(pair: Pair, atIso: string, news: readonly RedNewsEvent[]): RedNewsEvent | null {
  const currencies = pair.split("_");
  const at = Date.parse(atIso);
  const windowMs = NEWS_WINDOW_MINUTES * 60_000;
  return news.find((e) => currencies.includes(e.currency) && Math.abs(Date.parse(e.time) - at) <= windowMs) ?? null;
}

function tradesToday(input: StrategyInput, candleTime: string): number {
  const today = forexDayOpen(new Date(candleTime)).toISOString();
  return input.recentAlerts.filter(
    (a) => REACHED_READY.has(a.status) && forexDayOpen(new Date(a.sweepTime)).toISOString() === today,
  ).length;
}

function evaluate(input: StrategyInput): SetupEvent[] {
  const { pair, now, candles, settings } = input;
  const latestClosedOpen = new Date(now.getTime() - M15_MS).toISOString();
  const m15 = candles.M15.filter((c) => c.time <= latestClosedOpen);
  const candle = m15.at(-1);
  if (!candle || !inBreakoutWindow(candle.time)) return [];
  if (tradesToday(input, candle.time) >= MAX_TRADES_PER_FOREX_DAY) return [];

  const range = asianRange(m15, candle.time, pair);
  if (!range || !rangeAllowed(range)) return [];

  // Only the first qualifying breakout of the day counts: find it among
  // today's window candles so far. Nothing to do unless it is this candle.
  const pip = pipSize(pair);
  const atrValues = atr(m15, ATR_PERIOD);
  const windowStart = atHour(utcDayStart(candle.time), BREAKOUT_WINDOW_UTC[0]);
  let direction: Direction | null = null;
  let first = -1;
  for (let i = Math.max(1, m15.findIndex((c) => c.time >= windowStart)); i < m15.length; i++) {
    direction = breakoutDirection(m15[i] as Candle, range, atrValues[i - 1] as number, pip);
    if (direction) {
      first = i;
      break;
    }
  }
  if (!direction || first !== m15.length - 1) return [];

  // Against the 4H filter (or no filter yet): no trade today.
  if (filterDirection(candles.H4) !== direction) return [];

  const buy = direction === "BUY";
  const close = new Date(Date.parse(candle.time) + M15_MS).toISOString();
  const dedupeKey = sweepDedupeKey(pair, direction, candle.time);
  const extreme = buy ? candle.low : candle.high;
  const events: SetupEvent[] = [
    {
      type: "SWEEP",
      pair,
      dedupeKey,
      direction,
      // The broken Asian level (stored in sweepLevel and bosLevel).
      sweepType: buy ? "ASH" : "ASL",
      sweepLevel: buy ? range.high : range.low,
      sweepExtreme: extreme,
      sweepTime: candle.time,
      bosLevel: buy ? range.high : range.low,
      expiresAt: close,
    },
  ];
  const skip = (reason: string) => [...events, { type: "SKIP_INVALID" as const, dedupeKey, reason }];

  const news = redNewsNear(pair, close, input.redNews ?? []);
  if (news) return skip(`Red ${news.currency} news within ${NEWS_WINDOW_MINUTES} min`);

  const decimals = priceDecimals(pair);
  const stop = roundTo(extreme + (buy ? -1 : 1) * STOP_BUFFER_PIPS * pip, decimals);
  const stopPips = roundTo(Math.abs(roundTo(candle.close, decimals) - stop) / pip, 1);
  if (stopPips < MIN_STOP_PIPS || stopPips > MAX_STOP_PIPS) {
    return skip(`Stop ${stopPips.toFixed(1)} pips is outside ${MIN_STOP_PIPS}–${MAX_STOP_PIPS} pips`);
  }
  const result = buildTradeTicket({
    pair,
    direction,
    entry: candle.close,
    sweepExtreme: extreme,
    settings: { ...settings, stopBufferPips: STOP_BUFFER_PIPS, rewardRatio: REWARD_RATIO },
  });
  if (!result.ok) return skip(result.reason);
  return [...events, { type: "CONFIRM", dedupeKey, confirmTime: candle.time, ticket: result.ticket }];
}

export const londonBreak: Strategy = {
  id: "london-break",
  name: "London Breakout",
  description:
    "A 15m candle breaking the Asian range (00–07 UTC, 15–60 pips) between 07:00 and 10:00 UTC with a strong body, in the 4H EMA50 direction. Market entry, stop 2 pips beyond the candle (8–30 pips), target 1.5R, out at 16:00 UTC.",
  rewardRatio: REWARD_RATIO,
  exitAtUtcHour: EXIT_AT_UTC_HOUR,
  usesRedNews: true,
  evaluate,
};
