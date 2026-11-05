// DG v1 — sweep of liquidity against the D/H4 trend, confirmed by a 15m
// break of structure.
//
// DO NOT CHANGE RULES HERE once this strategy has produced alerts — copy it
// to a new id (e.g. dg-v2) and register that instead (architecture
// invariant: strategy versions are immutable, so past alerts and backtests
// stay reproducible).
import { TIMEFRAME_MS } from "@/lib/market/time";
import { applyEvents } from "../apply-events";
import { detectBos } from "../shared/bos";
import { getLiquidityLevels } from "../shared/liquidity";
import { detectSweep, extendsSweep } from "../shared/sweep";
import { buildTradeTicket } from "../shared/ticket";
import { getTrend } from "../shared/trend";
import type { SetupEvent, Strategy, StrategyInput } from "../types";

/**
 * Evaluates the latest closed M15 candle against the open setups, in order:
 * expire → confirm → extend → new sweep. Returns events only; the caller
 * persists them and passes the resulting WATCHING setups back next time.
 */
function evaluate(input: StrategyInput): SetupEvent[] {
  const { pair, now, candles, settings } = input;

  // Defensive: only candles that have closed by `now` (invariant 8).
  // Compares canonical ISO strings (see Candle.time) to avoid parsing every
  // candle on every call.
  const latestClosedOpen = new Date(now.getTime() - TIMEFRAME_MS.M15).toISOString();
  const m15 = candles.M15.filter((c) => c.time <= latestClosedOpen);
  const candle = m15.at(-1);
  if (!candle) return [];
  const history = m15.slice(0, -1);

  const events: SetupEvent[] = [];

  // 1. Expire setups whose window closed before this candle did.
  for (const setup of input.openSetups) {
    if (detectBos(setup, candle) === "EXPIRE") {
      events.push({ type: "EXPIRE", dedupeKey: setup.dedupeKey, time: setup.expiresAt });
    }
  }

  // 2. Confirm: a body close beyond the BOS level.
  for (const setup of applyEvents(input.openSetups, events)) {
    if (detectBos(setup, candle) !== "CONFIRM") continue;
    // The stop goes beyond the furthest point of the sweep move, including
    // the confirming candle if it reached further.
    const sweepExtreme =
      setup.direction === "SELL"
        ? Math.max(setup.sweepExtreme, candle.high)
        : Math.min(setup.sweepExtreme, candle.low);
    const result = buildTradeTicket({
      pair,
      direction: setup.direction,
      entry: candle.close,
      sweepExtreme,
      settings,
    });
    events.push(
      result.ok
        ? { type: "CONFIRM", dedupeKey: setup.dedupeKey, confirmTime: candle.time, ticket: result.ticket }
        : { type: "SKIP_INVALID", dedupeKey: setup.dedupeKey, reason: result.reason },
    );
  }

  // 3. Extend: price pushed further past the sweep without confirming.
  for (const setup of applyEvents(input.openSetups, events)) {
    if (extendsSweep(setup, candle)) {
      events.push({
        type: "EXTEND",
        dedupeKey: setup.dedupeKey,
        sweepExtreme: setup.direction === "SELL" ? candle.high : candle.low,
      });
    }
  }

  // 4. New sweep — only if no setup is WATCHING in that direction.
  const stillOpen = applyEvents(input.openSetups, events);
  const sweep = detectSweep({
    pair,
    trendD: getTrend(candles.D, settings.swingStrength),
    trendH4: getTrend(candles.H4, settings.swingStrength),
    levels: getLiquidityLevels({ pair, candles: { D: candles.D, M15: history }, settings }),
    history,
    candle,
    settings,
  });
  if (
    sweep &&
    !stillOpen.some((s) => s.direction === sweep.direction) &&
    !input.openSetups.some((s) => s.dedupeKey === sweep.dedupeKey)
  ) {
    events.push({ type: "SWEEP", pair, ...sweep });
  }

  return events;
}

export const dgV1: Strategy = {
  id: "dg-v1",
  name: "DG v1 · sweep + 15m BOS",
  description:
    "Daily and 4H trend must agree. A 15m candle sweeps the previous day's high/low or equal highs/lows against the trend (Watching); a later 15m body close beyond the last 15m swing confirms it (Ready). Stop beyond the sweep extreme plus a buffer, target at a fixed reward ratio.",
  evaluate,
};
