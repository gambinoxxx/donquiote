// Pure journal helpers: periods, stats, the strategy comparison and CSV.
import { summarizePaper, type PaperRow } from "@/lib/paper/summary";
import { DISPLAY_TIME_ZONE } from "./format";

export type JournalPeriod = "7d" | "30d" | "month" | "all";
export const JOURNAL_PERIODS: readonly JournalPeriod[] = ["7d", "30d", "month", "all"];
export const PERIOD_LABEL: Record<JournalPeriod, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  all: "All time",
};

const DAY_MS = 24 * 3_600_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** ISO start of the period (null = all time). "This month" is the Lagos calendar month. */
export function periodStart(period: JournalPeriod, now: Date): string | null {
  if (period === "all") return null;
  if (period === "7d") return new Date(now.getTime() - 7 * DAY_MS).toISOString();
  if (period === "30d") return new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "numeric" })
      .formatToParts(now)
      .map((x) => [x.type, Number(x.value)]),
  );
  // Lagos is UTC+1 all year: the month starts at 23:00 UTC the day before.
  return new Date(Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, 1) - 3_600_000).toISOString();
}

export interface StatsEntry {
  status: "OPEN" | "CLOSED";
  result: "WIN" | "LOSS" | "BREAKEVEN" | "CUSTOM" | null;
  resultR: number | null;
  pnlUsd: number | null;
}

export interface JournalStats {
  /** Closed trades in the period. */
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** wins ÷ (wins + losses); null with none. */
  winRate: number | null;
  netR: number;
  netUsd: number;
  /** netUsd ÷ account size. */
  pnlPct: number;
}

/** A custom result counts as a win or a loss by its sign (0 = break-even). */
export function outcomeOf(e: StatsEntry): "win" | "loss" | "breakeven" | null {
  if (e.status !== "CLOSED") return null;
  if (e.result === "WIN") return "win";
  if (e.result === "LOSS") return "loss";
  if (e.result === "BREAKEVEN") return "breakeven";
  const pnl = e.pnlUsd ?? 0;
  return pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven";
}

export function journalStats(closed: readonly StatsEntry[], accountSizeUsd: number): JournalStats {
  const outcomes = closed.map(outcomeOf);
  const wins = outcomes.filter((o) => o === "win").length;
  const losses = outcomes.filter((o) => o === "loss").length;
  const netUsd = round2(closed.reduce((s, e) => s + (e.pnlUsd ?? 0), 0));
  return {
    trades: closed.length,
    wins,
    losses,
    breakeven: outcomes.filter((o) => o === "breakeven").length,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    netR: round2(closed.reduce((s, e) => s + (e.resultR ?? 0), 0)),
    netUsd,
    pnlPct: accountSizeUsd > 0 ? round2((netUsd / accountSizeUsd) * 100) : 0,
  };
}

export interface ComparisonRow {
  strategyId: string;
  /** Closed paper trades (win, loss, unresolved). */
  closed: number;
  wins: number;
  losses: number;
  unresolved: number;
  notFilled: number;
  open: number;
  winRate: number | null;
  netR: number;
  netUsd: number;
  worstLosingStreak: number;
  early: boolean;
}

/**
 * Paper results per strategy for the period, plus totals that are the sum of
 * the rows (success criterion 9). Strategies with no trades still get a row.
 */
export function strategyComparison(
  strategyIds: readonly string[],
  rows: readonly PaperRow[],
  earlyUntil = 30,
): { rows: ComparisonRow[]; totals: Omit<ComparisonRow, "strategyId" | "worstLosingStreak" | "early"> } {
  const byId = new Map(summarizePaper(rows).map((s) => [s.strategyId, s]));
  const out: ComparisonRow[] = strategyIds.map((id) => {
    const s = byId.get(id);
    const closed = (s?.wins ?? 0) + (s?.losses ?? 0) + (s?.unresolved ?? 0);
    return {
      strategyId: id,
      closed,
      wins: s?.wins ?? 0,
      losses: s?.losses ?? 0,
      unresolved: s?.unresolved ?? 0,
      notFilled: s?.notFilled ?? 0,
      open: s?.open ?? 0,
      winRate: s?.winRate ?? null,
      netR: s?.netR ?? 0,
      netUsd: s?.netUsd ?? 0,
      worstLosingStreak: s?.worstLosingStreak ?? 0,
      early: closed < earlyUntil,
    };
  });
  const sum = (k: "closed" | "wins" | "losses" | "unresolved" | "notFilled" | "open" | "netR" | "netUsd") =>
    round2(out.reduce((acc, r) => acc + r[k], 0));
  const wins = sum("wins");
  const losses = sum("losses");
  return {
    rows: out,
    totals: {
      closed: sum("closed"),
      wins,
      losses,
      unresolved: sum("unresolved"),
      notFilled: sum("notFilled"),
      open: sum("open"),
      winRate: wins + losses > 0 ? wins / (wins + losses) : null,
      netR: sum("netR"),
      netUsd: sum("netUsd"),
    },
  };
}

// --- CSV ----------------------------------------------------------------------

/** RFC 4180 field: quoted when it holds a comma, quote or line break; formula-like text is defused. */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Spreadsheet formula injection: a cell starting with = + - @ runs as a formula.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
