// DG v2 candidate — dg-v1 with stronger liquidity only: previous day
// high/low, Asian session high/low and 1H equal highs/lows (no M15 equal
// highs/lows). Everything else is dg-v1: D + 4H trend agree, untouched
// level, BOS = last M15 swing before the sweep, body close confirms,
// watch expiry, stop buffer and reward ratio from Settings.
// Reference: doc/reference/v2.py with A=1, B=0, C=0, D=0.
//
// DO NOT CHANGE RULES HERE once this strategy has produced alerts — copy it
// to a new id (architecture invariant 11).
import { TIMEFRAME_MS } from "@/lib/market/time";
import { applyEvents } from "../apply-events";
import { detectBos } from "../shared/bos";
import { detectSweep, extendsSweep } from "../shared/sweep";
import { buildTradeTicket } from "../shared/ticket";
import { getTrend } from "../shared/trend";
import type { SetupEvent, Strategy, StrategyInput } from "../types";
import { getV2LiquidityLevels } from "./levels";

/** Same order as dg-v1: expire → confirm → extend → new sweep. */
function evaluate(input: StrategyInput): SetupEvent[] {
  const { pair, now, candles, settings } = input;

  const latestClosedOpen = new Date(now.getTime() - TIMEFRAME_MS.M15).toISOString();
  const m15 = candles.M15.filter((c) => c.time <= latestClosedOpen);
  const candle = m15.at(-1);
  if (!candle) return [];
  const history = m15.slice(0, -1);

  const events: SetupEvent[] = [];

  for (const setup of input.openSetups) {
    if (detectBos(setup, candle) === "EXPIRE") {
      events.push({ type: "EXPIRE", dedupeKey: setup.dedupeKey, time: setup.expiresAt });
    }
  }

  for (const setup of applyEvents(input.openSetups, events)) {
    if (detectBos(setup, candle) !== "CONFIRM") continue;
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

  for (const setup of applyEvents(input.openSetups, events)) {
    if (extendsSweep(setup, candle)) {
      events.push({
        type: "EXTEND",
        dedupeKey: setup.dedupeKey,
        sweepExtreme: setup.direction === "SELL" ? candle.high : candle.low,
      });
    }
  }

  const stillOpen = applyEvents(input.openSetups, events);
  const sweep = detectSweep({
    pair,
    trendD: getTrend(candles.D, settings.swingStrength),
    trendH4: getTrend(candles.H4, settings.swingStrength),
    levels: getV2LiquidityLevels({ pair, D: candles.D, history, candle, settings }),
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

export const dgV2Candidate: Strategy = {
  id: "dg-v2-candidate",
  name: "DG v2 · Strong liquidity",
  description:
    "dg-v1 with stronger liquidity only: previous day high/low, Asian session high/low and 1H equal highs/lows. No 15m equal highs/lows.",
  evaluate,
};
