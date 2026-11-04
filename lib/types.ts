// Shared domain types for DG Signals. Types only — no logic.

export type Pair =
  | "EUR_USD"
  | "GBP_USD"
  | "USD_JPY"
  | "USD_CAD"
  | "USD_CHF"
  | "XAU_USD";

export type Timeframe = "D" | "H4" | "M15";

export type Direction = "BUY" | "SELL";

export type AlertStatus = "WATCHING" | "READY" | "EXPIRED" | "TAKEN" | "SKIPPED";

export interface Candle {
  /** Candle open time, ISO 8601 string in UTC. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TradeTicket {
  entry: number;
  stop: number;
  target: number;
  stopPips: number;
  targetPips: number;
  /** Risk per trade as a percentage of the account, e.g. 0.5 for 0.5%. */
  riskPct: number;
  riskUsd: number;
  /** Standard lots, rounded down to 0.01. */
  lotSize: number;
}
