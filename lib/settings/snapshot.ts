// Settings snapshot: Settings + watchlist + strategy modes as one stable,
// sorted JSON value. Pure.
import type { Pair } from "@/lib/types";

export type Mode = "LIVE" | "TEST" | "OFF";

/** Every user-editable Settings column (the ones the Settings screen shows). */
export interface SettingsValues {
  accountSizeUsd: number;
  startingBalanceUsd: number;
  riskPct: number;
  rewardRatio: number;
  dailyLossLimitPct: number;
  maxDrawdownPct: number;
  warnDailyLossPct: number;
  stopDailyLossPct: number;
  warnOverallLossPct: number;
  maxTradesPerDay: number;
  stopBufferPips: number;
  watchExpiryMinutes: number;
  swingStrength: number;
  equalTolerancePips: number;
  paperTimeoutHours: number;
  pushEnabled: boolean;
  emailEnabled: boolean;
  watchingPushEnabled: boolean;
}

export const SETTINGS_KEYS: readonly (keyof SettingsValues)[] = [
  "accountSizeUsd",
  "startingBalanceUsd",
  "riskPct",
  "rewardRatio",
  "dailyLossLimitPct",
  "maxDrawdownPct",
  "warnDailyLossPct",
  "stopDailyLossPct",
  "warnOverallLossPct",
  "maxTradesPerDay",
  "stopBufferPips",
  "watchExpiryMinutes",
  "swingStrength",
  "equalTolerancePips",
  "paperTimeoutHours",
  "pushEnabled",
  "emailEnabled",
  "watchingPushEnabled",
];

export interface WatchlistEntry {
  pair: Pair;
  enabled: boolean;
  sortOrder: number;
}

export interface StrategyModeEntry {
  strategyId: string;
  mode: Mode;
}

export interface SettingsSnapshot {
  settings: SettingsValues;
  /** In watchlist order (sortOrder, then pair). */
  watchlist: WatchlistEntry[];
  /** Sorted by strategy id. */
  strategies: StrategyModeEntry[];
}

/**
 * The canonical snapshot: only the known fields, keys in a fixed order,
 * lists sorted. The same input always gives the same JSON.
 */
export function snapshot(
  settings: SettingsValues,
  watchlist: readonly WatchlistEntry[],
  modes: readonly StrategyModeEntry[],
): SettingsSnapshot {
  const values = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, settings[k]])) as unknown as SettingsValues;
  return {
    settings: values,
    watchlist: [...watchlist]
      .map((w) => ({ pair: w.pair, enabled: w.enabled, sortOrder: w.sortOrder }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.pair.localeCompare(b.pair)),
    strategies: [...modes]
      .map((m) => ({ strategyId: m.strategyId, mode: m.mode }))
      .sort((a, b) => a.strategyId.localeCompare(b.strategyId)),
  };
}

/** Stable JSON for comparisons and storage. */
export function snapshotJson(s: SettingsSnapshot): string {
  return JSON.stringify(snapshot(s.settings, s.watchlist, s.strategies));
}
