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

export interface RiskView {
  /** Risk guard maths arrives in Unit 14; until then only a neutral card. */
  state: "none" | "logged";
  tradesLogged: number;
  text: string;
}

export interface OverviewData {
  /** Server time the page was built (ISO). */
  now: string;
  risk: RiskView;
  scoreboard: ScoreRow[];
  latest: AlertListItem[];
  heartbeat: HeartbeatView;
}

export type ActionResult = { ok: true } | { ok: false; error: string };
