// Pure helpers behind lib/data: query shapes, cursors, scoreboard, seen-by,
// heartbeat, reason lines and the rule checklist. No I/O, so they are
// unit-tested without a database.
import type { Direction, EntryType, Pair } from "@/lib/types";
import { summarizePaper, type PaperRow } from "@/lib/paper/summary";
import type { RuleLine } from "@/lib/strategy/registry";
import { formatDuration, formatPrice, formatWhen } from "./format";
import type {
  AlertStatus,
  HeartbeatView,
  PaperStatus,
  PaperView,
  RuleItem,
  ScoreRow,
  StatusFilter,
  StrategyMode,
  StrategyTag,
} from "./types";

export const PAGE_SIZE = 30;
/** Alerts on the same pair + direction within this window "see" the same setup. */
export const SEEN_BY_WINDOW_MS = 30 * 60_000;
/** Results are "early" until this many closed paper trades. */
export const EARLY_UNTIL_TRADES = 30;
export const SCANNER_SLOW_AFTER_MS = 20 * 60_000;
export const SCANNER_STOPPED_AFTER_MS = 45 * 60_000;

const M15_MS = 15 * 60_000;

// --- Alert list query --------------------------------------------------------

export const STATUSES_FOR: Record<StatusFilter, readonly AlertStatus[] | null> = {
  all: null,
  ready: ["READY", "TAKEN"],
  watching: ["WATCHING"],
  expired: ["EXPIRED"],
  skipped: ["SKIPPED"],
};

/** Prisma `where` for the alerts list. */
export function alertsWhere(args: {
  status: StatusFilter;
  includeTest: boolean;
  liveStrategyIds: readonly string[];
  pair?: Pair;
}): Record<string, unknown> {
  const statuses = STATUSES_FOR[args.status];
  return {
    ...(statuses && { status: { in: [...statuses] } }),
    ...(!args.includeTest && { strategyId: { in: [...args.liveStrategyIds] } }),
    ...(args.pair && { pair: args.pair }),
  };
}

/** Newest first; id breaks ties so the cursor is stable. */
export const ALERTS_ORDER = [{ sweepTime: "desc" }, { id: "desc" }] as const;

/** Rows fetched with `take: PAGE_SIZE + 1` → one page plus the next cursor (the last row's id). */
export function toPage<T extends { id: string }>(rows: readonly T[], size = PAGE_SIZE): { rows: T[]; nextCursor: string | null } {
  const page = rows.slice(0, size);
  return { rows: page, nextCursor: rows.length > size ? (page.at(-1)?.id ?? null) : null };
}

// --- Strategies and tags ----------------------------------------------------

export interface StrategyMeta {
  id: string;
  code: string;
  name: string;
}

export function strategyTag(id: string, modes: ReadonlyMap<string, StrategyMode>, meta: (id: string) => StrategyMeta | null): StrategyTag {
  const m = meta(id);
  return { id, code: m?.code ?? id, name: m?.name ?? id, mode: modes.get(id) ?? "OFF" };
}

// --- Paper ------------------------------------------------------------------

export function paperView(row: {
  paperStatus: PaperStatus | null;
  paperResultR: number | null;
  paperPnlUsd: number | null;
  paperExitPrice: number | null;
  paperOpenedAt: Date | string | null;
  paperClosedAt: Date | string | null;
  paperNote: string | null;
}): PaperView | null {
  if (!row.paperStatus) return null;
  const iso = (d: Date | string | null) => (d === null ? null : typeof d === "string" ? d : d.toISOString());
  return {
    status: row.paperStatus,
    resultR: row.paperResultR,
    pnlUsd: row.paperPnlUsd,
    exitPrice: row.paperExitPrice,
    openedAt: iso(row.paperOpenedAt),
    closedAt: iso(row.paperClosedAt),
    note: row.paperNote,
  };
}

/** How a paper trade ended, e.g. "Target hit after 3h 15m". */
export function paperOutcomeText(p: PaperView): string {
  const after = p.openedAt && p.closedAt ? ` after ${formatDuration(Date.parse(p.closedAt) - Date.parse(p.openedAt))}` : "";
  switch (p.status) {
    case "OPEN":
      return "Tracking: closes at the target or the stop.";
    case "WIN":
      return `Target hit${after}`;
    case "LOSS":
      return p.note === "gapped through stop" ? `Gapped through the stop${after}` : p.note === "stop and target in same candle" ? `Stop and target in the same candle${after} (counted as a loss)` : p.note === "filled and stopped in same candle" ? `Filled and stopped in the same candle${after}` : `Stop hit${after}`;
    case "UNRESOLVED":
      return `No result within the time limit${after}; closed at the last price`;
    case "NOT_FILLED":
      return "The limit entry was never reached: not a trade (0R)";
  }
}

// --- Scoreboard -------------------------------------------------------------

export function scoreboard(strategies: readonly StrategyTag[], rows: readonly PaperRow[]): ScoreRow[] {
  const summaries = new Map(summarizePaper(rows).map((s) => [s.strategyId, s]));
  return strategies
    .filter((s) => s.mode !== "OFF")
    .map((strategy) => {
      const s = summaries.get(strategy.id);
      const closed = (s?.wins ?? 0) + (s?.losses ?? 0) + (s?.unresolved ?? 0);
      return {
        strategy,
        trades: s?.trades ?? 0,
        wins: s?.wins ?? 0,
        losses: s?.losses ?? 0,
        unresolved: s?.unresolved ?? 0,
        notFilled: s?.notFilled ?? 0,
        open: s?.open ?? 0,
        winRate: s?.winRate ?? null,
        netR: s?.netR ?? 0,
        netUsd: s?.netUsd ?? 0,
        closed,
        early: closed < EARLY_UNTIL_TRADES,
      };
    });
}

/** LIVE first, then the given (registry) order. */
export function orderStrategies(tags: readonly StrategyTag[]): StrategyTag[] {
  return tags
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(b.t.mode === "LIVE") - Number(a.t.mode === "LIVE") || a.i - b.i)
    .map(({ t }) => t);
}

// --- Seen by ----------------------------------------------------------------

/** When an alert happened: READY time, else the sweep candle's close. */
export function alertTime(a: { readyAt: Date | string | null; sweepTime: Date | string }): string {
  const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString());
  return a.readyAt ? iso(a.readyAt) : new Date(Date.parse(iso(a.sweepTime)) + M15_MS).toISOString();
}

/**
 * Strategies that saw this setup: this alert's strategy first, then the
 * notification group's (Unit 10) and every other alert on the same pair and
 * direction within 30 minutes. Live before Test, then by code.
 */
export function seenBy(args: {
  alert: { strategyId: string; pair: Pair; direction: Direction; time: string };
  groupStrategyIds: readonly string[];
  nearby: ReadonlyArray<{ strategyId: string; pair: Pair; direction: Direction; time: string }>;
  tag: (id: string) => StrategyTag;
}): StrategyTag[] {
  const t = Date.parse(args.alert.time);
  const ids = new Set<string>(args.groupStrategyIds);
  for (const n of args.nearby) {
    if (n.pair !== args.alert.pair || n.direction !== args.alert.direction) continue;
    if (Math.abs(Date.parse(n.time) - t) <= SEEN_BY_WINDOW_MS) ids.add(n.strategyId);
  }
  ids.delete(args.alert.strategyId);
  const others = [...ids]
    .map(args.tag)
    .sort((a, b) => Number(b.mode === "LIVE") - Number(a.mode === "LIVE") || a.code.localeCompare(b.code));
  return [args.tag(args.alert.strategyId), ...others];
}

// --- Heartbeat --------------------------------------------------------------

export function heartbeatView(lastScanAt: string | null, now: Date, marketOpen: boolean): HeartbeatView {
  if (!marketOpen) return { state: "closed", text: `Market closed${lastScanAt ? ` · last scan ${formatWhen(lastScanAt, now)}` : ""}` };
  if (!lastScanAt) return { state: "unknown", text: "Scanner has not run yet" };
  const age = now.getTime() - Date.parse(lastScanAt);
  const when = formatWhen(lastScanAt, now);
  if (age > SCANNER_STOPPED_AFTER_MS) return { state: "stopped", text: `Scanner stopped · last scan ${when}` };
  if (age > SCANNER_SLOW_AFTER_MS) return { state: "slow", text: `Scanner slow · last scan ${when}` };
  return { state: "ok", text: `Scanner OK · last scan ${when}` };
}

// --- Reason line and checklist ---------------------------------------------

export const SWEEP_LABEL: Record<string, string> = {
  PDH: "previous day high",
  PDL: "previous day low",
  EQH: "equal highs",
  EQL: "equal lows",
  ASH: "Asian session high",
  ASL: "Asian session low",
  H4H: "last 4H high",
  H4L: "last 4H low",
};

interface AlertFacts {
  strategyId: string;
  pair: Pair;
  direction: Direction;
  status: AlertStatus;
  sweepType: string;
  sweepLevel: number;
  bosLevel: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  stopPips: number | null;
  readyAt: string | null;
  statusNote: string | null;
  entryType: EntryType;
  paperStatus: PaperStatus | null;
}

/** Strategies built on the FVG Retest rules (same reason line). */
const FVG_STRATEGIES: ReadonlySet<string> = new Set(["gemini-fvg", "gemini-fvg-2r"]);
/** london-break breaks the Asian level instead of sweeping it. */
const BREAKOUT_STRATEGIES: ReadonlySet<string> = new Set(["london-break"]);

/** How this strategy confirms, for the reason line. */
function confirmPhrase(a: AlertFacts, done: boolean): string {
  const p = (v: number) => formatPrice(a.pair, v);
  const side = a.direction === "SELL" ? "below" : "above";
  if (BREAKOUT_STRATEGIES.has(a.strategyId)) {
    return done ? `breakout candle closed ${side} it` : "waiting for the breakout candle";
  }
  if (FVG_STRATEGIES.has(a.strategyId)) {
    return done ? `fair value gap, limit ${a.entry !== null ? p(a.entry) : ""}`.trim() : "waiting for a fair value gap";
  }
  if (a.bosLevel === null) return done ? "confirmed" : "waiting for confirmation";
  if (a.strategyId === "pro-v1-swing") {
    return done ? `closed back ${side} ${p(a.bosLevel)}` : `waiting for a close ${side} ${p(a.bosLevel)}`;
  }
  return done ? `15m body closed ${side} ${p(a.bosLevel)}` : `waiting for a 15m body close ${side} ${p(a.bosLevel)}`;
}

/** "15m body closed below 1.10150" (READY) or "Waiting for …" (Watching). */
export function confirmationText(a: AlertFacts): string {
  const text = confirmPhrase(a, a.readyAt !== null);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function reasonLine(a: AlertFacts): string {
  const verb = BREAKOUT_STRATEGIES.has(a.strategyId) ? "Broke" : "Swept";
  const swept = `${verb} ${SWEEP_LABEL[a.sweepType] ?? a.sweepType} ${formatPrice(a.pair, a.sweepLevel)}`;
  switch (a.status) {
    case "WATCHING":
      return `${swept}, ${confirmPhrase(a, false)}`;
    case "READY":
      return `${swept}, ${confirmPhrase(a, true)}`;
    case "TAKEN":
      return `${swept}, ${confirmPhrase(a, true)} · taken`;
    case "SKIPPED":
      return `${swept}, ${confirmPhrase(a, true)} · skipped`;
    case "EXPIRED":
      return a.statusNote ? `${swept} · skipped: ${a.statusNote}` : `${swept}, no confirmation in time`;
  }
}

/** The registry's rules with ✓ / ✗ from the stored fields (never recomputed). */
export function ruleChecklist(rules: readonly RuleLine[], a: AlertFacts): RuleItem[] {
  const p = (v: number) => formatPrice(a.pair, v);
  const reached = a.readyAt !== null;
  return rules.map((rule): RuleItem => {
    switch (rule.check) {
      case "trend":
      case "session":
      case "limits":
        // The strategy only opens a setup when these hold.
        return { text: rule.text, state: "met" };
      case "liquidity":
      case "sweep":
        return { text: rule.text, state: "met", detail: `Swept ${SWEEP_LABEL[a.sweepType] ?? a.sweepType} ${p(a.sweepLevel)}` };
      case "confirm":
        if (reached) return { text: rule.text, state: "met", detail: confirmPhrase(a, true).replace(/^./, (c) => c.toUpperCase()) };
        if (a.status === "EXPIRED") {
          return { text: rule.text, state: "not-met", detail: a.statusNote ?? "No confirmation before the watch window ended" };
        }
        return { text: rule.text, state: "pending", detail: confirmPhrase(a, false).replace(/^./, (c) => c.toUpperCase()) };
      case "ticket":
        if (a.entry !== null && a.stop !== null && a.target !== null) {
          return {
            text: rule.text,
            state: "met",
            detail: `Stop ${p(a.stop)}${a.stopPips !== null ? ` (${a.stopPips} pips)` : ""}, target ${p(a.target)}`,
          };
        }
        if (a.status === "EXPIRED" && a.statusNote) return { text: rule.text, state: "not-met", detail: a.statusNote };
        return { text: rule.text, state: "pending" };
      case "fill":
        if (a.paperStatus === "NOT_FILLED") return { text: rule.text, state: "not-met", detail: "Price never came back to the limit" };
        if (a.paperStatus && a.paperStatus !== "OPEN") return { text: rule.text, state: "met", detail: "Limit filled" };
        return { text: rule.text, state: reached ? "pending" : "info" };
      case "none":
        return { text: rule.text, state: "info" };
    }
  });
}
