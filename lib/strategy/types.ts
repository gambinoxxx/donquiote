// Strategy engine types. Pure data only.
import type { Candle, Direction, Pair, TradeTicket } from "@/lib/types";

/** PDH/PDL = previous forex day high/low; EQH/EQL = equal highs/lows. */
export type SweepType = "PDH" | "PDL" | "EQH" | "EQL";

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

export interface StrategyInput {
  pair: Pair;
  now: Date;
  /** Closed candles only, oldest first. */
  candles: { D: readonly Candle[]; H4: readonly Candle[]; M15: readonly Candle[] };
  settings: StrategySettings;
  openSetups: readonly OpenSetup[];
}

export type SetupEvent =
  | ({ type: "SWEEP"; pair: Pair } & OpenSetup)
  | { type: "EXTEND"; dedupeKey: string; sweepExtreme: number }
  | { type: "CONFIRM"; dedupeKey: string; confirmTime: string; ticket: TradeTicket }
  | { type: "EXPIRE"; dedupeKey: string; time: string }
  | { type: "SKIP_INVALID"; dedupeKey: string; reason: string };

export interface Strategy {
  id: string;
  name: string;
  description: string;
  evaluate(input: StrategyInput): SetupEvent[];
}
