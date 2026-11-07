// Pure helpers for the paper trade commands (paper:backfill, paper:report).
// No I/O: the scripts load rows and pass them in.
import type { AlertStatus } from "@/lib/types";
import type { PaperStatus } from "@/lib/paper/resolve";
import { isPaperTicket } from "@/lib/strategy/apply-events";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Alert statuses that went through READY, so they have a ticket. */
const PASSED_READY: readonly AlertStatus[] = ["READY", "TAKEN", "SKIPPED"];

/** The alert fields the backfill looks at. */
export interface BackfillAlert {
  id: string;
  status: AlertStatus;
  paperStatus: PaperStatus | null;
  /** ISO, UTC. */
  readyAt: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  stopPips: number | null;
  targetPips: number | null;
  lotSize: number | null;
  riskPct: number | null;
  riskUsd: number | null;
}

export interface BackfillOpen {
  alertId: string;
  /** = readyAt: the close time of the confirming candle. */
  paperOpenedAt: string;
}

/**
 * Alerts that should have a paper trade but don't: they passed READY, have
 * a complete, valid ticket and readyAt, and no paperStatus yet. Running it
 * again after the opens are saved returns nothing.
 */
export function planPaperBackfill(alerts: readonly BackfillAlert[]): BackfillOpen[] {
  return alerts.flatMap((a) => {
    if (!PASSED_READY.includes(a.status) || a.paperStatus !== null || a.readyAt === null) return [];
    const { entry, stop, target, stopPips, targetPips, lotSize, riskPct, riskUsd } = a;
    if (
      entry === null ||
      stop === null ||
      target === null ||
      stopPips === null ||
      targetPips === null ||
      lotSize === null ||
      riskPct === null ||
      riskUsd === null
    ) {
      return [];
    }
    const ticket = { entry, stop, target, stopPips, targetPips, lotSize, riskPct, riskUsd };
    return isPaperTicket(ticket) ? [{ alertId: a.id, paperOpenedAt: a.readyAt }] : [];
  });
}

/** One paper trade as the report needs it. */
export interface PaperRow {
  strategyId: string;
  paperStatus: PaperStatus;
  /** ISO, UTC; null while OPEN. */
  paperClosedAt: string | null;
  paperResultR: number | null;
  paperPnlUsd: number | null;
}

export interface PaperSummary {
  strategyId: string;
  trades: number;
  open: number;
  wins: number;
  losses: number;
  unresolved: number;
  /** LIMIT entries never reached in time: not trades, so not in win rate, R or streaks. */
  notFilled: number;
  /** wins ÷ (wins + losses); unresolved not counted. Null with no decided trades. */
  winRate: number | null;
  /** Sum over closed trades (WIN, LOSS and UNRESOLVED), like the backtest. */
  netR: number;
  netUsd: number;
  /** Longest run of LOSS in close order (anything else ends a run). */
  worstLosingStreak: number;
}

/** Totals per strategy, sorted by strategy id. Same rules as the backtest stats. */
export function summarizePaper(rows: readonly PaperRow[]): PaperSummary[] {
  const byStrategy = new Map<string, PaperRow[]>();
  for (const row of rows) {
    const list = byStrategy.get(row.strategyId) ?? [];
    list.push(row);
    byStrategy.set(row.strategyId, list);
  }
  return [...byStrategy.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([strategyId, list]) => {
      const count = (status: PaperStatus) => list.filter((r) => r.paperStatus === status).length;
      const wins = count("WIN");
      const losses = count("LOSS");
      const closed = list
        .filter((r) => r.paperStatus !== "OPEN" && r.paperStatus !== "NOT_FILLED")
        .sort((a, b) => (a.paperClosedAt ?? "").localeCompare(b.paperClosedAt ?? ""));
      let streak = 0;
      let worstLosingStreak = 0;
      for (const r of closed) {
        streak = r.paperStatus === "LOSS" ? streak + 1 : 0;
        worstLosingStreak = Math.max(worstLosingStreak, streak);
      }
      return {
        strategyId,
        trades: list.length - count("NOT_FILLED"),
        open: count("OPEN"),
        wins,
        losses,
        unresolved: count("UNRESOLVED"),
        notFilled: count("NOT_FILLED"),
        winRate: wins + losses > 0 ? wins / (wins + losses) : null,
        netR: round2(closed.reduce((sum, r) => sum + (r.paperResultR ?? 0), 0)),
        netUsd: round2(closed.reduce((sum, r) => sum + (r.paperPnlUsd ?? 0), 0)),
        worstLosingStreak,
      };
    });
}
