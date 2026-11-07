// View models for the dashboard. Plain, serialisable data only: pages and
// client components never receive Prisma objects. Times are ISO strings
// (UTC); format them with lib/data/format.ts.
import type { Direction, EntryType, Pair } from "@/lib/types";

export type AlertStatus = "WATCHING" | "READY" | "EXPIRED" | "TAKEN" | "SKIPPED";
export type StrategyMode = "LIVE" | "TEST" | "OFF";
export type PaperStatus = "OPEN" | "WIN" | "LOSS" | "UNRESOLVED" | "NOT_FILLED";

/** Alerts filter chips. "ready" also shows alerts DG marked as taken. */
export type StatusFilter = "all" | "ready" | "watching" | "expired" | "skipped";
export const STATUS_FILTERS: readonly StatusFilter[] = ["all", "ready", "watching", "expired", "skipped"];

export interface StrategyTag {
  id: string;
  code: string;
  name: string;
  /** Current mode. Test = muted with a dashed tag; Off counts as test. */
  mode: StrategyMode;
}

export interface PaperView {
  status: PaperStatus;
  resultR: number | null;
  pnlUsd: number | null;
  exitPrice: number | null;
  openedAt: string | null;
  closedAt: string | null;
  note: string | null;
}

/** One alert in a list (Home, Alerts). */
export interface AlertListItem {
  id: string;
  pair: Pair;
  direction: Direction;
  status: AlertStatus;
  strategy: StrategyTag;
  /** The strategy is not LIVE: show muted with a dashed tag. */
  isTest: boolean;
  /** When the alert happened: READY time, else the sweep candle's close. */
  time: string;
  /** One-line reason ("Swept previous day high 1.10700, …"). */
  reason: string;
  entryType: EntryType;
  paper: PaperView | null;
}

export interface AlertFilter {
  status: StatusFilter;
  includeTest: boolean;
  pair?: Pair;
  /** From the previous page's `nextCursor`. */
  cursor?: string | null;
}

export interface AlertPage {
  items: AlertListItem[];
  /** Pass back as `cursor` for the next 30; null on the last page. */
  nextCursor: string | null;
}

export interface TicketView {
  entry: number;
  stop: number;
  target: number;
  stopPips: number;
  targetPips: number;
  lotSize: number;
  riskPct: number;
  riskUsd: number;
  rewardUsd: number;
  rewardRatio: number;
  entryType: EntryType;
  entryValidUntil: string | null;
}

export type RuleState = "met" | "not-met" | "pending" | "info";

export interface RuleItem {
  text: string;
  state: RuleState;
  /** What the stored fields say, e.g. "Swept previous day high 1.10700". */
  detail?: string;
}

/** A candle for the mini chart (time = UTC seconds). */
export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AlertDetail extends AlertListItem {
  sweepType: string;
  sweepTypeLabel: string;
  sweepLevel: number;
  sweepExtreme: number;
  bosLevel: number | null;
  sweepTime: string;
  readyAt: string | null;
  expiresAt: string;
  expiredAt: string | null;
  statusNote: string | null;
  ticket: TicketView | null;
  /** This alert's strategy first, then others on the same pair + direction within 30 min. */
  seenBy: StrategyTag[];
  rules: RuleItem[];
  candles: ChartCandle[];
  /** Ask Claude text (lib/summary). */
  summary: string;
  /** Skip / I took this trade are offered (READY only, see architecture). */
  canDecide: boolean;
  /** DG logged it in the journal. */
  taken: boolean;
  /** The risk guard now (DG's own journal only). */
  guard: import("@/lib/risk/guard").RiskGuardView;
  /** Taking this trade would push the worst case today past the daily limit. */
  takeWouldBreach: boolean;
}

export interface ScoreRow {
  strategy: StrategyTag;
  /** Filled paper trades (Not filled excluded). */
  trades: number;
  wins: number;
  losses: number;
  unresolved: number;
  notFilled: number;
  open: number;
  /** wins ÷ (wins + losses); null with none decided. */
  winRate: number | null;
  netR: number;
  netUsd: number;
  /** Closed trades (win, loss, unresolved). */
  closed: number;
  /** Fewer than 30 closed trades: results are early. */
  early: boolean;
}

export type HeartbeatState = "ok" | "slow" | "stopped" | "closed" | "unknown";

export interface HeartbeatView {
  state: HeartbeatState;
  /** "Scanner OK · last scan 2 min ago", "Market closed", … */
  text: string;
}


export interface OverviewData {
  /** Server time the page was built (ISO). */
  now: string;
  risk: import("@/lib/risk/guard").RiskGuardView;
  scoreboard: ScoreRow[];
  latest: AlertListItem[];
  heartbeat: HeartbeatView;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

// --- Chart (Unit 12) ---------------------------------------------------------

export type ChartTimeframe = "D" | "H4" | "M15";
export type Trend = "UP" | "DOWN" | "RANGE";

export interface CandlePage {
  /** Closed candles, oldest first. */
  candles: ChartCandle[];
  /** More (older) stored candles exist before the first one. */
  hasMore: boolean;
}

export interface ChartLevelView {
  kind: "PDH" | "PDL" | "ASH" | "ASL" | "EQH" | "EQL";
  price: number;
  /** ISO: from when the level counts (EQH/EQL: first swing of the group). */
  since: string;
}

export interface ChartAlertView {
  id: string;
  strategy: StrategyTag;
  isTest: boolean;
  status: AlertStatus;
  direction: Direction;
  sweepType: string;
  sweepLevel: number;
  /** ISO: the sweep candle's open. */
  sweepTime: string;
  /** ISO: close of the confirming candle. */
  readyAt: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  lotSize: number | null;
  stopPips: number | null;
  targetPips: number | null;
  entryType: EntryType;
  paperStatus: PaperStatus | null;
}

export interface ChartContext {
  pair: Pair;
  timeframe: ChartTimeframe;
  decimals: number;
  trendD: Trend;
  trendH4: Trend;
  levels: ChartLevelView[];
  /** Alerts on this pair in the loaded range (Live and Test; the page filters). */
  alerts: ChartAlertView[];
  /** Trade lines: the ?alert= one, plus READY alerts with an open paper trade. */
  active: ChartAlertView[];
  lastClose: number | null;
  /** ISO: close time of the newest closed M15 candle. */
  lastCandleClose: string | null;
  dayChange: { openPrice: number; changePips: number; changePct: number } | null;
  marketOpen: boolean;
}

export interface ChartPairOption {
  pair: Pair;
  enabled: boolean;
}

// --- Settings, strategies, watchlist, history (Unit 13) ----------------------

export type { SettingsSnapshot, SettingsValues, Change } from "@/lib/settings";

export interface SettingsPageData {
  snapshot: import("@/lib/settings").SettingsSnapshot;
  /** Latest SettingsVersion: send it back when saving (safe saving). */
  versionId: string | null;
  lastChange: { at: string; by: string } | null;
  liveCount: number;
  testCount: number;
  pairsOn: number;
  pairsTotal: number;
}

export interface StrategyCard {
  id: string;
  code: string;
  name: string;
  description: string;
  rules: string[];
  mode: StrategyMode;
  paper: ScoreRow;
  worstLosingStreak: number;
}

export interface StrategiesPageData {
  strategies: StrategyCard[];
  versionId: string | null;
}

export interface WatchlistRow {
  pair: Pair;
  enabled: boolean;
  trendD: Trend;
  trendH4: Trend;
  /** OPEN paper trades on this pair (still tracked if the pair is switched off). */
  openPaperTrades: number;
}

export interface WatchlistPageData {
  pairs: WatchlistRow[];
  versionId: string | null;
}

export interface HistoryRow {
  id: string;
  createdAt: string;
  /** Who: the part before @, or "system". */
  by: string;
  changes: import("@/lib/settings").Change[];
  restoredFrom: { id: string; createdAt: string } | null;
  current: boolean;
  /** What Restore would change now (empty for the current version). */
  restorePreview: import("@/lib/settings").Change[];
}

export interface HistoryPage {
  rows: HistoryRow[];
  nextCursor: string | null;
  versionId: string | null;
}

// --- Journal and risk guard (Unit 14) ----------------------------------------

export type { RiskGuardView } from "@/lib/risk/guard";
export type { JournalPeriod, JournalStats, ComparisonRow } from "./journal-logic";

export interface JournalEntryView {
  id: string;
  alertId: string | null;
  strategy: StrategyTag | null;
  pair: Pair;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  lots: number;
  riskUsd: number;
  openedAt: string;
  status: "OPEN" | "CLOSED";
  result: "WIN" | "LOSS" | "BREAKEVEN" | "CUSTOM" | null;
  resultR: number | null;
  pnlUsd: number | null;
  closedAt: string | null;
  note: string | null;
}

export interface JournalPageData {
  period: import("./journal-logic").JournalPeriod;
  guard: import("@/lib/risk/guard").RiskGuardView;
  stats: import("./journal-logic").JournalStats;
  open: JournalEntryView[];
  /** Closed in the period, newest first. */
  history: JournalEntryView[];
  /** For "Add trade": the risk per trade from Settings. */
  defaultRiskUsd: number;
}

export interface SignalRow {
  id: string;
  pair: Pair;
  direction: Direction;
  strategy: StrategyTag;
  isTest: boolean;
  status: AlertStatus;
  /** ISO: when it became Ready. */
  readyAt: string;
  entryType: EntryType;
  paper: PaperView | null;
  /** "you took it", "skipped", "not marked". */
  decision: "taken" | "skipped" | "none";
}

export interface SignalsPageData {
  period: import("./journal-logic").JournalPeriod;
  comparison: { strategy: StrategyTag; row: import("./journal-logic").ComparisonRow }[];
  totals: Omit<import("./journal-logic").ComparisonRow, "strategyId" | "worstLosingStreak" | "early">;
  signals: SignalRow[];
  strategies: StrategyTag[];
}
