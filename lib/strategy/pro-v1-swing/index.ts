// Pro Sweep (pro-v1-swing). Rules: project-overview.md → Registered
// strategies; reference: doc/reference/prov1.py → run(bias_mode="swing").
//
// - D and 4H swing trends must agree (dg-v1's swing structure).
// - Liquidity: previous day high/low and the last closed 4H high/low.
// - Sweep: a 15m candle trades through the level and closes back inside it
//   (within 1 pip). One setup at a time per pair.
// - Break: within the next 8 candles, a 15m close at least 0.5 pip beyond
//   the level in the trend direction → READY, entry at that close.
// - Stop: the furthest point of the move (sweep through break candle)
//   ± 3 pips; it must be 6–35 pips, otherwise the setup is skipped.
//   Target 3R.
// - Active 07:00–16:00 UTC (candle open time), at most 1 trade per pair per
//   forex day.
//
// DO NOT CHANGE RULES HERE once this strategy has produced alerts — copy it
// to a new id (architecture invariant 11).
import type { Candle, Direction } from "@/lib/types";
import { pipSize } from "@/lib/market/pip";
import { forexDayOpen, TIMEFRAME_MS } from "@/lib/market/time";
import { applyEvents } from "../apply-events";
import { extendsSweep, sweepDedupeKey, tradeDirection } from "../shared/sweep";
import { buildTradeTicket } from "../shared/ticket";
import { getTrend } from "../shared/trend";
import type { OpenSetup, SetupEvent, Strategy, StrategyInput, SweepType } from "../types";

export const SWING_STRENGTH = 2;
/** The reference needs more than 25 closed D and 4H candles before trading. */
export const MIN_HTF_CANDLES = 26;
/** The sweep candle must close back inside the level, within this many pips. */
export const CLOSE_BACK_PIPS = 1;
/** The break close must be at least this far beyond the level. */
export const BREAK_PIPS = 0.5;
/** Candles after the sweep in which the break may come. */
export const BREAK_WINDOW_CANDLES = 8;
export const STOP_BUFFER_PIPS = 3;
export const MIN_STOP_PIPS = 6;
export const MAX_STOP_PIPS = 35;
export const REWARD_RATIO = 3;
/** Active hours, UTC [from, to), by candle open time. */
export const SESSION_UTC: readonly [number, number] = [7, 16];
export const MAX_TRADES_PER_FOREX_DAY = 1;

const M15_MS = TIMEFRAME_MS.M15;
const H4_MS = TIMEFRAME_MS.H4;

export function inSession(candleTime: string): boolean {
  const hour = new Date(candleTime).getUTCHours();
  return hour >= SESSION_UTC[0] && hour < SESSION_UTC[1];
}

/** Trades already taken (alerts that reached READY) in the candle's forex day. */
function tradesToday(input: StrategyInput, candleTime: string): number {
  const today = forexDayOpen(new Date(candleTime)).toISOString();
  return input.recentAlerts.filter((a) => {
    if (a.readyAt === undefined || !["READY", "TAKEN", "SKIPPED"].includes(a.status)) return false;
    const confirmOpen = new Date(Date.parse(a.readyAt) - M15_MS);
    return forexDayOpen(confirmOpen).toISOString() === today;
  }).length;
}

function newSweep(input: StrategyInput, candle: Candle): OpenSetup | null {
  const { pair, candles } = input;
  if (candles.D.length < MIN_HTF_CANDLES || candles.H4.length < MIN_HTF_CANDLES) return null;
  const direction = tradeDirection(getTrend(candles.D, SWING_STRENGTH), getTrend(candles.H4, SWING_STRENGTH));
  if (!direction) return null;

  const previousDay = candles.D.at(-1);
  // The last 4H candle closed by this candle's open.
  const lastH4 = candles.H4.filter((c) => Date.parse(c.time) + H4_MS <= Date.parse(candle.time)).at(-1);
  if (!previousDay || !lastH4) return null;

  const pip = pipSize(pair);
  const levels: Array<{ type: SweepType; price: number }> =
    direction === "SELL"
      ? [
          { type: "PDH", price: previousDay.high },
          { type: "H4H", price: lastH4.high },
        ]
      : [
          { type: "PDL", price: previousDay.low },
          { type: "H4L", price: lastH4.low },
        ];
  for (const level of levels) {
    const swept =
      direction === "SELL"
        ? candle.high > level.price && candle.close < level.price + CLOSE_BACK_PIPS * pip
        : candle.low < level.price && candle.close > level.price - CLOSE_BACK_PIPS * pip;
    if (!swept) continue;
    return {
      dedupeKey: sweepDedupeKey(pair, direction, candle.time),
      direction,
      sweepType: level.type,
      sweepLevel: level.price,
      sweepExtreme: direction === "SELL" ? candle.high : candle.low,
      sweepTime: candle.time,
      // The break close must reach this price (level ∓ 0.5 pip).
      bosLevel: direction === "SELL" ? level.price - BREAK_PIPS * pip : level.price + BREAK_PIPS * pip,
      expiresAt: new Date(Date.parse(candle.time) + (BREAK_WINDOW_CANDLES + 1) * M15_MS).toISOString(),
    };
  }
  return null;
}

function breaks(direction: Direction, candle: Candle, bosLevel: number): boolean {
  return direction === "SELL" ? candle.close <= bosLevel : candle.close >= bosLevel;
}

function evaluate(input: StrategyInput): SetupEvent[] {
  const { pair, now, candles, settings } = input;
  const latestClosedOpen = new Date(now.getTime() - M15_MS).toISOString();
  const m15 = candles.M15.filter((c) => c.time <= latestClosedOpen);
  const candle = m15.at(-1);
  if (!candle) return [];
  const pip = pipSize(pair);
  const close = new Date(Date.parse(candle.time) + M15_MS).toISOString();
  const events: SetupEvent[] = [];

  // 1. Expire after the break window.
  for (const setup of input.openSetups) {
    if (close > setup.expiresAt) events.push({ type: "EXPIRE", dedupeKey: setup.dedupeKey, time: setup.expiresAt });
  }

  // 2. Break: in session and no trade yet today; otherwise keep waiting.
  let ended = false;
  for (const setup of applyEvents(input.openSetups, events)) {
    if (candle.time <= setup.sweepTime) continue;
    if (!breaks(setup.direction, candle, setup.bosLevel)) continue;
    if (!inSession(candle.time) || tradesToday(input, candle.time) >= MAX_TRADES_PER_FOREX_DAY) continue;
    ended = true;
    const sell = setup.direction === "SELL";
    const extreme = sell ? Math.max(setup.sweepExtreme, candle.high) : Math.min(setup.sweepExtreme, candle.low);
    const stop = sell ? extreme + STOP_BUFFER_PIPS * pip : extreme - STOP_BUFFER_PIPS * pip;
    const risk = Math.abs(stop - candle.close);
    if (!(MIN_STOP_PIPS * pip <= risk && risk <= MAX_STOP_PIPS * pip)) {
      events.push({
        type: "SKIP_INVALID",
        dedupeKey: setup.dedupeKey,
        reason: `Stop ${(risk / pip).toFixed(1)} pips is outside ${MIN_STOP_PIPS}–${MAX_STOP_PIPS} pips`,
      });
      continue;
    }
    const result = buildTradeTicket({
      pair,
      direction: setup.direction,
      entry: candle.close,
      sweepExtreme: extreme,
      settings: { ...settings, stopBufferPips: STOP_BUFFER_PIPS, rewardRatio: REWARD_RATIO },
    });
    events.push(
      result.ok
        ? { type: "CONFIRM", dedupeKey: setup.dedupeKey, confirmTime: candle.time, ticket: result.ticket }
        : { type: "SKIP_INVALID", dedupeKey: setup.dedupeKey, reason: result.reason },
    );
  }

  // 3. Extend while waiting.
  for (const setup of applyEvents(input.openSetups, events)) {
    if (extendsSweep(setup, candle)) {
      events.push({
        type: "EXTEND",
        dedupeKey: setup.dedupeKey,
        sweepExtreme: setup.direction === "SELL" ? candle.high : candle.low,
      });
    }
  }

  // 4. New sweep: nothing waiting, not on a break candle, in session, no trade today.
  if (
    !ended &&
    applyEvents(input.openSetups, events).length === 0 &&
    inSession(candle.time) &&
    tradesToday(input, candle.time) < MAX_TRADES_PER_FOREX_DAY
  ) {
    const sweep = newSweep(input, candle);
    if (sweep && !input.openSetups.some((s) => s.dedupeKey === sweep.dedupeKey)) {
      events.push({ type: "SWEEP", pair, ...sweep });
    }
  }
  return events;
}

export const proV1Swing: Strategy = {
  id: "pro-v1-swing",
  name: "Pro Sweep",
  description:
    "Daily and 4H swing trends agree. A 15m candle sweeps the previous day or last 4H high/low and closes back inside; a close beyond the level within 8 candles enters. Stop 3 pips beyond the sweep (6–35 pips), target 3R, 07–16 UTC, one trade per pair per day.",
  evaluate,
};
