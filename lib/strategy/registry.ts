import { dgV1 } from "./dg-v1";
import { dgV2Candidate } from "./dg-v2-candidate";
import { geminiFvg } from "./gemini-fvg";
import { geminiFvg2r } from "./gemini-fvg-2r";
import { londonBreak } from "./london-break";
import { proV1Swing } from "./pro-v1-swing";
import type { Strategy } from "./types";

/**
 * Which stored alert fields show whether a rule held (for the checklist on
 * the alert screen; the strategy is never recomputed):
 * - trend / session / limits: needed to open the setup at all
 * - liquidity / sweep: the swept level is stored
 * - confirm: the alert reached READY (EXPIRED without it = not met)
 * - ticket: entry, stop and target are stored
 * - fill: the limit entry's paper fill (Not filled = not met)
 * - none: background only, no mark
 */
export type RuleCheck = "trend" | "session" | "limits" | "liquidity" | "sweep" | "confirm" | "ticket" | "fill" | "none";

export interface RuleLine {
  text: string;
  check: RuleCheck;
}

/** What the app shows about a strategy (Strategies screen, tags, filters). */
export interface StrategyInfo {
  strategy: Strategy;
  id: string;
  /** Name in the app (project-overview.md → Registered strategies). */
  name: string;
  /** Short tag: V1, V2, FVG, PRO. */
  code: string;
  description: string;
  /** Plain-language rules, one per line, for the rules sheet and checklist. */
  rules: readonly RuleLine[];
}

/** Every strategy version. Never remove one that has produced alerts. */
const REGISTRY: readonly StrategyInfo[] = [
  {
    strategy: dgV1,
    id: dgV1.id,
    name: "DG v1 · Original",
    code: "V1",
    description: "DG's own setup: a sweep of liquidity against the trend, confirmed by a 15m break of structure.",
    rules: [
      { text: "Daily and 4H trend must agree (higher highs and higher lows, or lower highs and lower lows).", check: "trend" },
      { text: "Liquidity: previous day high/low and 15m equal highs/lows (current and previous forex day).", check: "liquidity" },
      { text: "Sweep: a 15m candle trades through an untouched level against the trend → Watching.", check: "sweep" },
      { text: "Confirm: a later 15m body close beyond the last 15m swing before the sweep → Ready, entry at that close.", check: "confirm" },
      { text: "Stop beyond the sweep extreme plus the stop buffer (Settings); target at the reward ratio (1:3).", check: "ticket" },
      { text: "Watching expires after the watch window (Settings, default 2 hours).", check: "none" },
    ],
  },
  {
    strategy: dgV2Candidate,
    id: dgV2Candidate.id,
    name: "DG v2 · Strong liquidity",
    code: "V2",
    description: "dg-v1 with stronger liquidity only. Everything else is the same.",
    rules: [
      { text: "Same trend, sweep, confirmation, stop, target and expiry rules as DG v1.", check: "trend" },
      { text: "Liquidity: previous day high/low, Asian session high/low (forex-day open → 07:00 UTC) and 1H equal highs/lows (two 1H swings within the equal tolerance, current and previous forex day).", check: "liquidity" },
      { text: "No 15m equal highs/lows.", check: "none" },
    ],
  },
  {
    strategy: geminiFvg,
    id: geminiFvg.id,
    name: "FVG Retest",
    code: "FVG",
    description: "A sweep in the London or New York window, then a strong candle leaving a fair value gap; limit entry back at the gap.",
    rules: [
      { text: "Direction: 15m close below the EMA50 of closed 4H candles → sells only; above → buys only.", check: "trend" },
      { text: "Liquidity: previous day high/low or the Asian high/low (00:00–07:00 UTC), each once per day.", check: "liquidity" },
      { text: "Sweeps only count 07:00–11:00 or 13:00–17:00 UTC.", check: "session" },
      { text: "Within 8 candles after the sweep, a candle in the trade direction with a body over 1.5 × ATR14 that leaves a fair value gap → Ready.", check: "confirm" },
      { text: "Limit entry at the near edge of the gap, valid for 16 candles; if price never returns, the trade is Not filled.", check: "fill" },
      { text: "Stop 2 pips beyond the sweep extreme; target 3R.", check: "ticket" },
      { text: "One setup or trade at a time per pair.", check: "limits" },
    ],
  },
  {
    strategy: proV1Swing,
    id: proV1Swing.id,
    name: "Pro Sweep",
    code: "PRO",
    description: "A sweep of the previous day or last 4H high/low that closes back inside, then a close beyond the level.",
    rules: [
      { text: "Daily and 4H swing trends must agree.", check: "trend" },
      { text: "Liquidity: previous day high/low and the last closed 4H high/low.", check: "liquidity" },
      { text: "Sweep: a 15m candle trades through the level and closes back inside it (within 1 pip).", check: "sweep" },
      { text: "Break: within 8 candles, a 15m close at least 0.5 pip beyond the level in the trend direction → Ready, entry at that close.", check: "confirm" },
      { text: "Stop 3 pips beyond the sweep extreme and must be 6–35 pips; target 3R.", check: "ticket" },
      { text: "Active 07:00–16:00 UTC; at most one trade per pair per forex day.", check: "limits" },
    ],
  },
  {
    strategy: geminiFvg2r,
    id: geminiFvg2r.id,
    name: "FVG Retest · 1:2",
    code: "FVG2",
    description: "FVG Retest with a 2R target instead of 3R; every other rule is the same, so the two can be compared side by side.",
    rules: [
      { text: "Same direction, liquidity, session, fair value gap, limit entry and one-at-a-time rules as FVG Retest.", check: "trend" },
      { text: "Limit entry at the near edge of the gap, valid for 16 candles; if price never returns, the trade is Not filled.", check: "fill" },
      { text: "Stop 2 pips beyond the sweep extreme; target 2R.", check: "ticket" },
    ],
  },
  {
    strategy: londonBreak,
    id: londonBreak.id,
    name: "London Breakout",
    code: "LDN",
    description: "A strong 15m breakout of the Asian range at the London open, in the 4H EMA50 direction; target 1.5R, out by 16:00 UTC.",
    rules: [
      { text: "Asian range: high and low of the 15m candles 00:00–07:00 UTC; no trade if it is under 15 or over 60 pips.", check: "liquidity" },
      { text: "Direction: last closed 4H close above the EMA50 of closed 4H candles → buys only; below → sells only.", check: "trend" },
      { text: "Breakout window 07:00–10:00 UTC.", check: "session" },
      { text: "Breakout: the first 15m candle whose body closes at least 1 pip beyond the range, with a body of at least 50% of its range and at least 1 × ATR14 → Ready, market entry at that close. Only the first breakout of the day counts.", check: "confirm" },
      { text: "Stop 2 pips beyond the breakout candle's other end, must be 8–30 pips; target 1.5R.", check: "ticket" },
      { text: "Still open at 16:00 UTC → closed at that candle's close as Unresolved.", check: "none" },
      { text: "At most one trade per pair per forex day; skipped if red news for either currency is within 30 minutes.", check: "limits" },
    ],
  },
];

export function listStrategies(): readonly Strategy[] {
  return REGISTRY.map((info) => info.strategy);
}

export function listStrategyInfo(): readonly StrategyInfo[] {
  return REGISTRY;
}

function find(id: string): StrategyInfo {
  const info = REGISTRY.find((s) => s.id === id);
  if (!info) {
    throw new Error(`Unknown strategy "${id}". Known: ${REGISTRY.map((s) => s.id).join(", ")}`);
  }
  return info;
}

/** The strategy with this id, or undefined (e.g. an id no longer registered). */
export function findStrategy(id: string): Strategy | undefined {
  return REGISTRY.find((s) => s.id === id)?.strategy;
}

/** The strategy with this id. Throws for an unknown id. */
export function getStrategy(id: string): Strategy {
  return find(id).strategy;
}

/** App metadata (name, code, rules) for this id. Throws for an unknown id. */
export function getStrategyInfo(id: string): StrategyInfo {
  return find(id);
}
