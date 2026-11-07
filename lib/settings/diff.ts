// Readable differences between two snapshots, e.g.
// { field: "Risk per trade", from: "1%", to: "0.5%" }. Pure.
import type { Pair } from "@/lib/types";
import type { SettingsSnapshot, SettingsValues } from "./snapshot";
import { SETTINGS_KEYS } from "./snapshot";

export interface Change {
  field: string;
  from: string;
  to: string;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const num = (n: number) => String(Number(n.toFixed(4)));
const pct = (n: number) => `${num(n)}%`;
const loss = (n: number) => `−${num(n)}%`;

const two = (n: number) => String(n).padStart(2, "0");

export const SETTING_LABELS: Record<keyof SettingsValues, { label: string; format: (v: never) => string }> = {
  accountSizeUsd: { label: "Account size", format: (v: number) => usd(v) },
  startingBalanceUsd: { label: "Starting balance", format: (v: number) => usd(v) },
  riskPct: { label: "Risk per trade", format: (v: number) => pct(v) },
  rewardRatio: { label: "Risk to reward", format: (v: number) => `1:${num(v)}` },
  dailyLossLimitPct: { label: "Daily loss limit", format: (v: number) => pct(v) },
  maxDrawdownPct: { label: "Max drawdown", format: (v: number) => pct(v) },
  warnDailyLossPct: { label: "Warn me at (today)", format: (v: number) => loss(v) },
  stopDailyLossPct: { label: "Done for the day at", format: (v: number) => loss(v) },
  warnOverallLossPct: { label: "Warn me at (overall)", format: (v: number) => loss(v) },
  maxTradesPerDay: { label: "Max trades per day", format: (v: number) => num(v) },
  stopBufferPips: { label: "Stop buffer", format: (v: number) => `${num(v)} pips` },
  watchExpiryMinutes: { label: "Setup expires after", format: (v: number) => `${num(v)} min` },
  swingStrength: { label: "Swing strength", format: (v: number) => `${num(v)} candles` },
  equalTolerancePips: { label: "Equal highs/lows tolerance", format: (v: number) => `${num(v)} pips` },
  paperTimeoutHours: { label: "Paper trade time limit", format: (v: number) => `${num(v)} h` },
  dayResetTz: { label: "Prop day time zone", format: (v: string) => v },
  dayResetHour: { label: "Prop day starts at", format: (v: number) => `${two(v)}:00` },
  drawdownType: { label: "Max drawdown type", format: (v: string) => (v === "TRAILING" ? "trailing" : "static") },
  pushEnabled: { label: "App alerts (push)", format: (v: boolean) => (v ? "on" : "off") },
  emailEnabled: { label: "Email backup", format: (v: boolean) => (v ? "on" : "off") },
  watchingPushEnabled: { label: "Watching alerts", format: (v: boolean) => (v ? "on" : "off") },
};

const PAIR_NAMES: Partial<Record<Pair, string>> = { XAU_USD: "Gold (XAU/USD)" };
export const pairName = (pair: Pair) => PAIR_NAMES[pair] ?? pair.replace("_", "/");

const MODE_NAMES = { LIVE: "Live", TEST: "Test", OFF: "Off" } as const;

/** Changes from `a` (before) to `b` (after), in screen order. `strategyName` maps ids to names. */
export function diff(a: SettingsSnapshot, b: SettingsSnapshot, strategyName: (id: string) => string = (id) => id): Change[] {
  const changes: Change[] = [];
  for (const key of SETTINGS_KEYS) {
    const from = a.settings[key];
    const to = b.settings[key];
    if (from === to) continue;
    const { label, format } = SETTING_LABELS[key];
    const f = format as (v: number | boolean | string) => string;
    changes.push({ field: label, from: f(from), to: f(to) });
  }
  const pairs = new Set([...a.watchlist, ...b.watchlist].map((w) => w.pair));
  for (const pair of pairs) {
    const from = a.watchlist.find((w) => w.pair === pair);
    const to = b.watchlist.find((w) => w.pair === pair);
    if (from?.enabled !== to?.enabled) {
      changes.push({ field: pairName(pair), from: from ? (from.enabled ? "on" : "off") : "—", to: to ? (to.enabled ? "on" : "off") : "—" });
    }
  }
  const ids = new Set([...a.strategies, ...b.strategies].map((s) => s.strategyId));
  for (const id of [...ids].sort()) {
    const from = a.strategies.find((s) => s.strategyId === id)?.mode;
    const to = b.strategies.find((s) => s.strategyId === id)?.mode;
    if (from !== to) changes.push({ field: strategyName(id), from: from ? MODE_NAMES[from] : "—", to: to ? MODE_NAMES[to] : "—" });
  }
  return changes;
}
