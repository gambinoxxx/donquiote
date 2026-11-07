// FVG Retest (gemini-fvg). Rules: project-overview.md → Registered
// strategies; reference: doc/reference/others.py → gemini().
//
// - Direction: the 15m close against the EMA50 of closed 4H candles.
// - Liquidity: previous day high/low, or the Asian high/low (00:00–07:00 UTC).
//   Each level counts once per forex day and direction.
// - Sweeps only in 07:00–11:00 or 13:00–17:00 UTC (candle open time).
// - Within 8 candles after the sweep, a displacement candle in the trade
//   direction (body > 1.5 × ATR14 of the candles before it) that leaves a
//   fair value gap with the next candle (bearish: next high < previous low).
// - READY when the gap's candle closes: LIMIT entry at the gap's near edge
//   (SELL: that candle's high; BUY: its low), valid 16 candles. Stop 2 pips
//   beyond the sweep extreme, target 3R.
// - One setup or trade at a time per pair (see ONE_AT_A_TIME note below).
//
// DO NOT CHANGE RULES HERE once this strategy has produced alerts — copy it
// to a new id (architecture invariant 11).
import type { Candle, Direction } from "@/lib/types";
import { pipSize } from "@/lib/market/pip";
import { forexDayOpen, TIMEFRAME_MS } from "@/lib/market/time";
import { PAPER_TIMEOUT_CANDLES, resolvePaperTrade } from "@/lib/paper/resolve";
import { applyEvents } from "../apply-events";
import { extendsSweep, sweepDedupeKey } from "../shared/sweep";
import { buildTradeTicket } from "../shared/ticket";
import type { OpenSetup, RecentAlert, SetupEvent, Strategy, StrategyInput, SweepType } from "../types";
import { atr, ema } from "./indicators";

export const EMA_PERIOD_H4 = 50;
export const ATR_PERIOD = 14;
/** Displacement candle body must be larger than this × ATR14. */
export const DISPLACEMENT_ATR_MULTIPLE = 1.5;
/** The displacement candle must be one of the 8 candles after the sweep. */
export const DISPLACEMENT_WINDOW_CANDLES = 8;
/** The limit entry may fill during the 16 candles after Ready. */
export const LIMIT_VALID_CANDLES = 16;
export const STOP_BUFFER_PIPS = 2;
export const REWARD_RATIO = 3;
/** Sweep sessions, UTC hours [from, to). */
export const SWEEP_SESSIONS_UTC: ReadonlyArray<readonly [number, number]> = [
  [7, 11],
  [13, 17],
];
/** Asian range used as liquidity, UTC hours [from, to) of the candle's calendar day. */
export const ASIAN_RANGE_UTC: readonly [number, number] = [0, 7];
/** The Asian range needs more than this many M15 candles to count. */
export const MIN_ASIAN_CANDLES_EXCLUSIVE = 8;
/**
 * ONE_AT_A_TIME: a new sweep is ignored while this strategy has a setup
 * WATCHING on the pair, or a READY trade that is still open (waiting for
 * its limit fill, or filled and not yet decided). Decided with the same
 * resolver and time limit (288 candles) the reference uses.
 */
export const BUSY_TIMEOUT_CANDLES = PAPER_TIMEOUT_CANDLES;

const M15_MS = TIMEFRAME_MS.M15;
const H4_MS = TIMEFRAME_MS.H4;
/** Close of the displacement window: sweep + 1 (gap candle) + 8. */
const WATCH_CANDLES = DISPLACEMENT_WINDOW_CANDLES + 1;
const REACHED_READY: ReadonlySet<RecentAlert["status"]> = new Set(["READY", "TAKEN", "SKIPPED"]);

const closeIso = (candle: Candle) => new Date(Date.parse(candle.time) + M15_MS).toISOString();
const utcHour = (iso: string) => new Date(iso).getUTCHours();

export function inSweepSession(candleTime: string): boolean {
  const hour = utcHour(candleTime);
  return SWEEP_SESSIONS_UTC.some(([from, to]) => hour >= from && hour < to);
}

/** True if this alert's trade is still waiting for a fill or undecided after `history`. */
function tradeStillOpen(alert: RecentAlert, history: readonly Candle[]): boolean {
  if (!REACHED_READY.has(alert.status) || alert.readyAt === undefined) return false;
  if (alert.entry === undefined || alert.stop === undefined || alert.target === undefined) return false;
  if (alert.entry === alert.stop) return false;
  const readyAt = alert.readyAt;
  const after = history.filter((c) => c.time >= readyAt);
  const result = resolvePaperTrade(
    {
      pair: "EUR_USD", // pair and risk do not affect the status
      direction: alert.direction,
      entry: alert.entry,
      stop: alert.stop,
      target: alert.target,
      riskUsd: 1,
      openedAt: readyAt,
      entryType: alert.entryType ?? "MARKET",
      ...(alert.entryValidUntil !== undefined && { entryValidUntil: alert.entryValidUntil }),
    },
    after,
    BUSY_TIMEOUT_CANDLES,
  );
  return result.status === "OPEN";
}

/** The gap confirmed at `candle` (the candle after the displacement), or null. */
function fairValueGap(
  direction: Direction,
  m15: readonly Candle[],
  atrValues: readonly number[],
): { entry: number } | null {
  const n = m15.length;
  const next = m15[n - 1]; // the candle that completes the gap
  const displacement = m15[n - 2];
  const before = m15[n - 3];
  const atrBefore = atrValues[n - 3];
  if (!next || !displacement || !before || atrBefore === undefined) return null;
  const body = Math.abs(displacement.close - displacement.open);
  if (!(body > DISPLACEMENT_ATR_MULTIPLE * atrBefore)) return null;
  if (direction === "SELL" && displacement.close < displacement.open && next.high < before.low) {
    return { entry: next.high };
  }
  if (direction === "BUY" && displacement.close > displacement.open && next.low > before.high) {
    return { entry: next.low };
  }
  return null;
}

function newSweep(input: StrategyInput, candle: Candle, history: readonly Candle[]): OpenSetup | null {
  const { pair, candles } = input;
  if (!inSweepSession(candle.time)) return null;

  // 4H candles closed by this candle's open, as in the reference.
  const h4Closed = candles.H4.filter((c) => Date.parse(c.time) + H4_MS <= Date.parse(candle.time));
  if (h4Closed.length <= EMA_PERIOD_H4) return null;
  const emaH4 = ema(
    h4Closed.map((c) => c.close),
    EMA_PERIOD_H4,
  ).at(-1) as number;
  const direction: Direction = candle.close < emaH4 ? "SELL" : "BUY";

  const previousDay = candles.D.at(-1);
  if (!previousDay) return null;
  const pip = pipSize(pair);
  const day = new Date(candle.time);
  const asiaFrom = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), ASIAN_RANGE_UTC[0])).toISOString();
  const asiaTo = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), ASIAN_RANGE_UTC[1])).toISOString();
  const asia = history.filter((c) => c.time >= asiaFrom && c.time < asiaTo);

  const levels: Array<{ type: SweepType; price: number }> =
    direction === "SELL" ? [{ type: "PDH", price: previousDay.high }] : [{ type: "PDL", price: previousDay.low }];
  if (asia.length > MIN_ASIAN_CANDLES_EXCLUSIVE) {
    levels.push(
      direction === "SELL"
        ? { type: "ASH", price: Math.max(...asia.map((c) => c.high)) }
        : { type: "ASL", price: Math.min(...asia.map((c) => c.low)) },
    );
  }

  // A level counts once per forex day and direction (an alert records each sweep).
  const today = forexDayOpen(day).toISOString();
  const used = new Set(
    input.recentAlerts
      .filter((a) => a.direction === direction && forexDayOpen(new Date(a.sweepTime)).toISOString() === today)
      .map((a) => Math.round(a.sweepLevel / pip)),
  );
  for (const level of levels) {
    if (used.has(Math.round(level.price / pip))) continue;
    const swept = direction === "SELL" ? candle.high > level.price : candle.low < level.price;
    if (!swept) continue;
    return {
      dedupeKey: sweepDedupeKey(pair, direction, candle.time),
      direction,
      sweepType: level.type,
      sweepLevel: level.price,
      sweepExtreme: direction === "SELL" ? candle.high : candle.low,
      sweepTime: candle.time,
      // No break of structure in this strategy: the swept level is stored.
      bosLevel: level.price,
      expiresAt: new Date(Date.parse(candle.time) + (WATCH_CANDLES + 1) * M15_MS).toISOString(),
    };
  }
  return null;
}

function evaluate(input: StrategyInput): SetupEvent[] {
  const { pair, now, candles, settings } = input;
  const latestClosedOpen = new Date(now.getTime() - M15_MS).toISOString();
  const m15 = candles.M15.filter((c) => c.time <= latestClosedOpen);
  const candle = m15.at(-1);
  if (!candle) return [];
  const history = m15.slice(0, -1);
  const events: SetupEvent[] = [];

  // 1. Expire: no gap within the displacement window.
  for (const setup of input.openSetups) {
    if (closeIso(candle) > setup.expiresAt) {
      events.push({ type: "EXPIRE", dedupeKey: setup.dedupeKey, time: setup.expiresAt });
    }
  }

  // 2. Confirm: the previous candle displaced and this one completes the gap.
  const atrValues = atr(m15, ATR_PERIOD);
  for (const setup of applyEvents(input.openSetups, events)) {
    const displacement = m15.at(-2);
    if (!displacement || displacement.time <= setup.sweepTime) continue;
    const gap = fairValueGap(setup.direction, m15, atrValues);
    if (!gap) continue;
    const result = buildTradeTicket({
      pair,
      direction: setup.direction,
      entry: gap.entry,
      // Extreme through the displacement candle (EXTEND events so far).
      sweepExtreme: setup.sweepExtreme,
      settings: { ...settings, stopBufferPips: STOP_BUFFER_PIPS, rewardRatio: REWARD_RATIO },
    });
    events.push(
      result.ok
        ? {
            type: "CONFIRM",
            dedupeKey: setup.dedupeKey,
            confirmTime: candle.time,
            ticket: result.ticket,
            entryType: "LIMIT",
            entryValidUntil: new Date(
              Date.parse(candle.time) + (1 + LIMIT_VALID_CANDLES) * M15_MS,
            ).toISOString(),
          }
        : { type: "SKIP_INVALID", dedupeKey: setup.dedupeKey, reason: result.reason },
    );
  }

  // 3. Extend.
  for (const setup of applyEvents(input.openSetups, events)) {
    if (extendsSweep(setup, candle)) {
      events.push({
        type: "EXTEND",
        dedupeKey: setup.dedupeKey,
        sweepExtreme: setup.direction === "SELL" ? candle.high : candle.low,
      });
    }
  }

  // 4. New sweep, only when nothing is in progress on this pair.
  const busy =
    applyEvents(input.openSetups, events).length > 0 ||
    events.some((e) => e.type === "CONFIRM") ||
    input.recentAlerts.some((a) => tradeStillOpen(a, history));
  if (!busy) {
    const sweep = newSweep(input, candle, history);
    if (sweep && !input.openSetups.some((s) => s.dedupeKey === sweep.dedupeKey)) {
      events.push({ type: "SWEEP", pair, ...sweep });
    }
  }
  return events;
}

export const geminiFvg: Strategy = {
  id: "gemini-fvg",
  name: "FVG Retest",
  description:
    "Direction from the 15m close against the 4H EMA50. A sweep of the previous day or Asian high/low in the London or New York window, then a strong candle leaving a fair value gap: limit entry at the gap, stop 2 pips beyond the sweep, target 3R.",
  evaluate,
};
