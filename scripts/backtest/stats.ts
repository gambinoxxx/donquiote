// Pure backtest statistics.
import { NOTE_GAPPED_STOP, NOTE_SAME_CANDLE } from "@/lib/paper/resolve";
import type { SetupRecord, TradeRecord } from "./engine";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface MonthRow {
  /** YYYY-MM in Lagos time, by trade close. */
  month: string;
  trades: number;
  wins: number;
  losses: number;
  netR: number;
}

export interface Summary {
  setups: number;
  confirmed: number;
  expired: number;
  invalid: number;
  watchingAtEnd: number;
  trades: number;
  wins: number;
  losses: number;
  unresolved: number;
  /** LIMIT entries never reached in time (not in trades, win rate or R). */
  notFilled: number;
  open: number;
  /** wins ÷ (wins + losses); null with no decided trades. */
  winRate: number | null;
  netR: number;
  netUsd: number;
  /** Net R ÷ closed trades (wins + losses + unresolved). */
  avgR: number | null;
  worstLosingStreak: number;
  maxDrawdownR: number;
  maxDrawdownUsd: number;
  bestMonth: MonthRow | null;
  worstMonth: MonthRow | null;
  months: MonthRow[];
  sameCandleLosses: number;
  gappedLosses: number;
}

const lagosMonth = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
});

function monthOf(iso: string): string {
  return lagosMonth.format(new Date(iso)).slice(0, 7);
}

export function summarize(setups: readonly SetupRecord[], allTrades: readonly TradeRecord[]): Summary {
  // A limit entry that never filled is not a trade: counted apart, 0R.
  const trades = allTrades.filter((t) => t.result.status !== "NOT_FILLED");
  const notFilled = allTrades.length - trades.length;
  const closed = trades
    .filter((t) => t.result.status !== "OPEN" && t.result.closedAt)
    .sort((a, b) => (a.result.closedAt ?? "").localeCompare(b.result.closedAt ?? ""));
  const count = (status: string) => trades.filter((t) => t.result.status === status).length;
  const wins = count("WIN");
  const losses = count("LOSS");

  let netR = 0;
  let netUsd = 0;
  let peakR = 0;
  let peakUsd = 0;
  let maxDrawdownR = 0;
  let maxDrawdownUsd = 0;
  let streak = 0;
  let worstLosingStreak = 0;
  const months = new Map<string, MonthRow>();

  for (const trade of closed) {
    const r = trade.result.resultR ?? 0;
    const usd = trade.result.pnlUsd ?? 0;
    netR += r;
    netUsd += usd;
    peakR = Math.max(peakR, netR);
    peakUsd = Math.max(peakUsd, netUsd);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - netR);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peakUsd - netUsd);

    streak = trade.result.status === "LOSS" ? streak + 1 : 0;
    worstLosingStreak = Math.max(worstLosingStreak, streak);

    const key = monthOf(trade.result.closedAt ?? "");
    const row = months.get(key) ?? { month: key, trades: 0, wins: 0, losses: 0, netR: 0 };
    row.trades++;
    if (trade.result.status === "WIN") row.wins++;
    if (trade.result.status === "LOSS") row.losses++;
    row.netR = round2(row.netR + r);
    months.set(key, row);
  }

  const monthRows = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  const byR = [...monthRows].sort((a, b) => b.netR - a.netR);

  return {
    setups: setups.length,
    confirmed: setups.filter((s) => s.status === "CONFIRMED").length,
    expired: setups.filter((s) => s.status === "EXPIRED").length,
    invalid: setups.filter((s) => s.status === "INVALID").length,
    watchingAtEnd: setups.filter((s) => s.status === "WATCHING").length,
    trades: trades.length,
    wins,
    losses,
    unresolved: count("UNRESOLVED"),
    notFilled,
    open: count("OPEN"),
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    netR: round2(netR),
    netUsd: round2(netUsd),
    avgR: closed.length > 0 ? round2(netR / closed.length) : null,
    worstLosingStreak,
    maxDrawdownR: round2(maxDrawdownR),
    maxDrawdownUsd: round2(maxDrawdownUsd),
    bestMonth: byR[0] ?? null,
    worstMonth: byR.at(-1) ?? null,
    months: monthRows,
    sameCandleLosses: trades.filter((t) => t.result.note === NOTE_SAME_CANDLE).length,
    gappedLosses: trades.filter((t) => t.result.note === NOTE_GAPPED_STOP).length,
  };
}
