// The dashboard's only way to the data. Server-only: pages and server
// components call these; client components get the returned view models
// (or call the server actions in ./actions.ts). Never import Prisma, OANDA
// or worker/ from app/ or components/.
import "server-only";
import type { Pair } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import type { Alert } from "@/lib/db/generated/client";
import { isMarketOpen } from "@/lib/market/time";
import { getStrategyInfo, listStrategyInfo } from "@/lib/strategy/registry";
import { buildAlertSummary } from "@/lib/summary";
import {
  ALERTS_ORDER,
  alertsWhere,
  alertTime,
  confirmationText,
  heartbeatView,
  orderStrategies,
  PAGE_SIZE,
  paperView,
  reasonLine,
  ruleChecklist,
  scoreboard,
  seenBy,
  strategyTag,
  SWEEP_LABEL,
  toPage,
  type StrategyMeta,
} from "./logic";
import type {
  AlertDetail,
  AlertFilter,
  AlertListItem,
  AlertPage,
  OverviewData,
  RiskView,
  StrategyMode,
  StrategyTag,
} from "./types";

export type * from "./types";

const M15_MS = 15 * 60_000;
/** Mini chart: candles before and after the alert. */
const CHART_BEFORE = 45;
const CHART_AFTER = 15;
const LATEST_ON_HOME = 5;

function meta(id: string): StrategyMeta | null {
  try {
    const info = getStrategyInfo(id);
    return { id, code: info.code, name: info.name };
  } catch {
    return null;
  }
}

interface StrategyContext {
  tag: (id: string) => StrategyTag;
  liveIds: string[];
  /** Registered strategies in registry order, with their modes. */
  all: StrategyTag[];
}

async function strategyContext(): Promise<StrategyContext> {
  const rows = await getDb().strategyConfig.findMany({ select: { strategyId: true, mode: true } });
  const modes = new Map<string, StrategyMode>(rows.map((r) => [r.strategyId, r.mode]));
  const tag = (id: string) => strategyTag(id, modes, meta);
  return {
    tag,
    liveIds: rows.filter((r) => r.mode === "LIVE").map((r) => r.strategyId),
    all: listStrategyInfo().map((info) => tag(info.id)),
  };
}

function facts(a: Alert) {
  return {
    strategyId: a.strategyId,
    pair: a.pair,
    direction: a.direction,
    status: a.status,
    sweepType: a.sweepType,
    sweepLevel: a.sweepLevel,
    bosLevel: a.bosLevel,
    entry: a.entry,
    stop: a.stop,
    target: a.target,
    stopPips: a.stopPips,
    readyAt: a.readyAt ? a.readyAt.toISOString() : null,
    statusNote: a.statusNote,
    entryType: a.entryType,
    paperStatus: a.paperStatus,
  };
}

function listItem(a: Alert, ctx: StrategyContext): AlertListItem {
  const strategy = ctx.tag(a.strategyId);
  return {
    id: a.id,
    pair: a.pair,
    direction: a.direction,
    status: a.status,
    strategy,
    isTest: strategy.mode !== "LIVE",
    time: alertTime(a),
    reason: reasonLine(facts(a)),
    entryType: a.entryType,
    paper: paperView(a),
  };
}

// --- Alerts -----------------------------------------------------------------

/** One page (30) of alerts, newest first. */
export async function getAlerts(filter: AlertFilter): Promise<AlertPage> {
  const ctx = await strategyContext();
  const rows = await getDb().alert.findMany({
    where: alertsWhere({ status: filter.status, includeTest: filter.includeTest, liveStrategyIds: ctx.liveIds, pair: filter.pair }),
    orderBy: [...ALERTS_ORDER],
    take: PAGE_SIZE + 1,
    ...(filter.cursor && { cursor: { id: filter.cursor }, skip: 1 }),
  });
  const page = toPage(rows);
  return { items: page.rows.map((a) => listItem(a, ctx)), nextCursor: page.nextCursor };
}

export async function getAlert(id: string): Promise<AlertDetail | null> {
  const db = getDb();
  const a = await db.alert.findUnique({ where: { id }, include: { notifyGroup: true, journal: { select: { id: true } } } });
  if (!a) return null;
  const [ctx, settings] = await Promise.all([strategyContext(), db.settings.findUniqueOrThrow({ where: { id: 1 } })]);
  const item = listItem(a, ctx);

  // Other alerts on this pair + direction around the same time.
  const window = 2 * 3_600_000;
  const nearbyRows = await db.alert.findMany({
    where: {
      pair: a.pair,
      direction: a.direction,
      id: { not: a.id },
      sweepTime: { gte: new Date(a.sweepTime.getTime() - window), lte: new Date(a.sweepTime.getTime() + window) },
    },
    select: { strategyId: true, pair: true, direction: true, readyAt: true, sweepTime: true },
  });
  const seen = seenBy({
    alert: { strategyId: a.strategyId, pair: a.pair, direction: a.direction, time: item.time },
    groupStrategyIds: a.notifyGroup?.strategyIds ?? [],
    nearby: nearbyRows.map((n) => ({ ...n, time: alertTime(n) })),
    tag: ctx.tag,
  });

  // ~60 M15 candles around the alert.
  const anchor = new Date(Date.parse(item.time) - M15_MS);
  const [before, after] = await Promise.all([
    db.candle.findMany({
      where: { pair: a.pair, timeframe: "M15", time: { lte: anchor } },
      orderBy: { time: "desc" },
      take: CHART_BEFORE,
    }),
    db.candle.findMany({
      where: { pair: a.pair, timeframe: "M15", time: { gt: anchor } },
      orderBy: { time: "asc" },
      take: CHART_AFTER,
    }),
  ]);
  const candles = [...before.reverse(), ...after].map((c) => ({
    time: Math.floor(c.time.getTime() / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  let info: ReturnType<typeof getStrategyInfo> | null = null;
  try {
    info = getStrategyInfo(a.strategyId);
  } catch {
    info = null;
  }
  const f = facts(a);
  const rules = ruleChecklist(info?.rules ?? [], f);

  const ticket =
    a.entry !== null && a.stop !== null && a.target !== null && a.stopPips !== null && a.targetPips !== null && a.lotSize !== null && a.riskUsd !== null
      ? {
          entry: a.entry,
          stop: a.stop,
          target: a.target,
          stopPips: a.stopPips,
          targetPips: a.targetPips,
          lotSize: a.lotSize,
          riskPct: a.riskPct ?? settings.riskPct,
          riskUsd: a.riskUsd,
          rewardRatio: Math.round((a.targetPips / a.stopPips) * 10) / 10,
          rewardUsd: Math.round((a.riskUsd * a.targetPips) / a.stopPips),
          entryType: a.entryType,
          entryValidUntil: a.entryValidUntil ? a.entryValidUntil.toISOString() : null,
        }
      : null;

  const summary = buildAlertSummary({
    pair: a.pair,
    direction: a.direction,
    status: a.status,
    time: item.time,
    strategy: { name: item.strategy.name, mode: item.strategy.mode },
    alsoSeenBy: seen.slice(1).map((s) => ({ name: s.name, mode: s.mode })),
    sweepLabel: SWEEP_LABEL[a.sweepType] ?? a.sweepType,
    sweepLevel: a.sweepLevel,
    confirmation: confirmationText(f),
    ticket,
    paper: item.paper,
    accountSizeUsd: settings.accountSizeUsd,
    riskGuard: (await riskView()).text,
    rules: (info?.rules ?? []).map((r) => r.text),
  });

  return {
    ...item,
    sweepType: a.sweepType,
    sweepTypeLabel: SWEEP_LABEL[a.sweepType] ?? a.sweepType,
    sweepLevel: a.sweepLevel,
    sweepExtreme: a.sweepExtreme,
    bosLevel: a.bosLevel,
    sweepTime: a.sweepTime.toISOString(),
    readyAt: a.readyAt ? a.readyAt.toISOString() : null,
    expiresAt: a.expiresAt.toISOString(),
    expiredAt: a.expiredAt ? a.expiredAt.toISOString() : null,
    statusNote: a.statusNote,
    ticket,
    seenBy: seen,
    rules,
    candles,
    summary,
    canDecide: a.status === "READY",
    taken: a.status === "TAKEN" || a.journal !== null,
  };
}

// --- Overview ---------------------------------------------------------------

async function riskView(): Promise<RiskView> {
  const tradesLogged = await getDb().journalEntry.count();
  // The risk guard maths (drawdown from journal results) arrives in Unit 14.
  if (tradesLogged === 0) return { state: "none", tradesLogged, text: "no trades logged yet" };
  return {
    state: "logged",
    tradesLogged,
    text: `${tradesLogged} trade${tradesLogged === 1 ? "" : "s"} logged; results are logged in the Journal`,
  };
}

export async function getOverview(now = new Date()): Promise<OverviewData> {
  const db = getDb();
  const ctx = await strategyContext();
  const [heartbeat, risk, paperRows, latestRows] = await Promise.all([
    db.workerHeartbeat.findUnique({ where: { id: 1 }, select: { lastScanAt: true } }),
    riskView(),
    db.alert.findMany({
      where: { paperStatus: { not: null } },
      select: { strategyId: true, paperStatus: true, paperClosedAt: true, paperResultR: true, paperPnlUsd: true },
    }),
    db.alert.findMany({
      where: { strategyId: { in: ctx.liveIds } },
      orderBy: [...ALERTS_ORDER],
      take: LATEST_ON_HOME,
    }),
  ]);
  return {
    now: now.toISOString(),
    risk,
    scoreboard: scoreboard(
      orderStrategies(ctx.all),
      paperRows.map((r) => ({
        strategyId: r.strategyId,
        paperStatus: r.paperStatus as NonNullable<typeof r.paperStatus>,
        paperClosedAt: r.paperClosedAt ? r.paperClosedAt.toISOString() : null,
        paperResultR: r.paperResultR,
        paperPnlUsd: r.paperPnlUsd,
      })),
    ),
    latest: latestRows.map((a) => listItem(a, ctx)),
    heartbeat: heartbeatView(heartbeat?.lastScanAt ? heartbeat.lastScanAt.toISOString() : null, now, isMarketOpen(now)),
  };
}

/** Whether a pair is a known pair code (for ?pair= in URLs). */
export function parsePair(value: string | undefined): Pair | undefined {
  const pairs: readonly Pair[] = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"];
  return pairs.find((p) => p === value);
}
export { getCandles, getChartContext, getChartPairs } from "./chart";
export { getHistoryPage, getSettingsPage, getStrategiesPage, getWatchlistPage } from "./settings";
