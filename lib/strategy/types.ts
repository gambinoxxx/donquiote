// Strategy engine types. Pure data only.
import type { AlertStatus, Candle, Direction, EntryType, Pair, TradeTicket } from "@/lib/types";

/**
 * Swept liquidity. PDH/PDL = previous forex day high/low; EQH/EQL = equal
 * highs/lows; ASH/ASL = Asian session high/low; H4H/H4L = high/low of the
 * last closed 4H candle. Each strategy defines its own windows.
 */
export type SweepType = "PDH" | "PDL" | "EQH" | "EQL" | "ASH" | "ASL" | "H4H" | "H4L";

/** Which side of price a level sits on: highs are swept by SELL setups. */
export const SWEEP_SIDE: Record<SweepType, "HIGH" | "LOW"> = {
  PDH: "HIGH",
  EQH: "HIGH",
  ASH: "HIGH",
  H4H: "HIGH",
  PDL: "LOW",
  EQL: "LOW",
  ASL: "LOW",
  H4L: "LOW",
};

export type Trend = "UP" | "DOWN" | "RANGE";

/** Values from the Settings row, passed in by the caller. */
export interface StrategySettings {
  accountSizeUsd: number;
  riskPct: number;
  rewardRatio: number;
  stopBufferPips: number;
  watchExpiryMinutes: number;
  /** Candles on each side of a swing point. */
  swingStrength: number;
  equalTolerancePips: number;
}

/** An alert that is still WATCHING for this pair. */
export interface OpenSetup {
  dedupeKey: string;
  direction: Direction;
  sweepType: SweepType;
  sweepLevel: number;
  sweepExtreme: number;
  /** Open time (ISO, UTC) of the sweep candle. */
  sweepTime: string;
  bosLevel: number;
  /** ISO, UTC. */
  expiresAt: string;
}

/**
 * Read-only view of one of this strategy's alerts on this pair (any status),
 * as it stood before the candle being evaluated. Lets a pure strategy apply
 * limits like "one trade per forex day" or "one open trade at a time".
 */
export interface RecentAlert {
  dedupeKey: string;
  direction: Direction;
  status: AlertStatus;
  sweepType: SweepType;
  sweepLevel: number;
  /** Open time (ISO, UTC) of the sweep candle. */
  sweepTime: string;
  /** ISO, UTC: close of the confirming candle; set once READY. */
  readyAt?: string;
  entry?: number;
  stop?: number;
  target?: number;
  entryType?: EntryType;
  /** ISO, UTC: last close time a LIMIT entry may fill at. */
  entryValidUntil?: string;
}

export interface StrategyInput {
  pair: Pair;
  now: Date;
  /** Closed candles only, oldest first. */
  candles: { D: readonly Candle[]; H4: readonly Candle[]; M15: readonly Candle[] };
  settings: StrategySettings;
  openSetups: readonly OpenSetup[];
  /**
   * This strategy's alerts on this pair whose sweep candle is inside the
   * M15 window (oldest first). Covers the current forex day and enough
   * history to tell whether a trade is still open. Filled the same way by
   * the worker and the backtester (lib/strategy/replay.ts).
   */
  recentAlerts: readonly RecentAlert[];
  /**
   * Red (HIGH impact) calendar events for the pair's currencies around the
   * candles being evaluated. Only passed to strategies with
   * `usesRedNews`; absent in the backtest (no stored history of news).
   */
  redNews?: readonly RedNewsEvent[];
}

/** A stored red calendar event (NewsEvent with impact HIGH). */
export interface RedNewsEvent {
  /** "USD", "EUR", … */
  currency: string;
  /** ISO, UTC. */
  time: string;
}

export type SetupEvent =
  | ({ type: "SWEEP"; pair: Pair } & OpenSetup)
  | { type: "EXTEND"; dedupeKey: string; sweepExtreme: number }
  | {
      type: "CONFIRM";
      dedupeKey: string;
      /** Open time of the candle that confirmed (READY at its close). */
      confirmTime: string;
      ticket: TradeTicket;
      /** Default MARKET: filled at `ticket.entry` at once. */
      entryType?: EntryType;
      /** LIMIT only (ISO, UTC): the entry may fill on candles closing by then. */
      entryValidUntil?: string;
    }
  | { type: "EXPIRE"; dedupeKey: string; time: string }
  | { type: "SKIP_INVALID"; dedupeKey: string; reason: string };

export interface Strategy {
  id: string;
  name: string;
  description: string;
  evaluate(input: StrategyInput): SetupEvent[];
  /**
   * The strategy's fixed reward ratio (target = stop distance × this).
   * Absent: the Settings value (dg-v1, dg-v2-candidate; default 3).
   */
  rewardRatio?: number;
  /**
   * Paper trades still open at this UTC hour on the day they opened close
   * as Unresolved at that candle's close (lib/paper/). Absent: only the
   * Settings time limit (72 h) applies.
   */
  exitAtUtcHour?: number;
  /** The worker passes stored red calendar news in `StrategyInput.redNews`. */
  usesRedNews?: boolean;
}
