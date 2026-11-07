// Chart data (Unit 12). Server-only, like the rest of lib/data.
import "server-only";
import type { Candle, Pair } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import type { Alert } from "@/lib/db/generated/client";
import { priceDecimals } from "@/lib/market/pip";
import { isMarketOpen } from "@/lib/market/time";
import { getStrategyInfo } from "@/lib/strategy/registry";
import { closedOnly, clampLimit, computeChartLevels, dayChange, latestClosedOpen, LEVEL_WINDOWS } from "./chart-logic";
import { strategyTag } from "./logic";
import type { CandlePage, ChartAlertView, ChartContext, ChartPairOption, ChartTimeframe, StrategyMode, StrategyTag } from "./types";

const toCandle = (c: { time: Date; open: number; high: number; low: number; close: number }): Candle => ({
  time: c.time.toISOString(),
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
});

/** Watchlist pairs, enabled first (in watchlist order). */
export async function getChartPairs(): Promise<ChartPairOption[]> {
  const rows = await getDb().watchlistPair.findMany({ orderBy: { sortOrder: "asc" }, select: { pair: true, enabled: true } });
  return [...rows.filter((r) => r.enabled), ...rows.filter((r) => !r.enabled)];
}

/**
 * Closed candles, oldest first. `limit` defaults to 500 and is capped at
 * 1,000; `before` (UTC seconds) loads older history for scroll-back.
 */
export async function getCandles(
  pair: Pair,
  timeframe: ChartTimeframe,
  options: { before?: number; after?: number; limit?: number } = {},
  now = new Date(),
): Promise<CandlePage> {
  const limit = clampLimit(options.limit);
  const cutoff = latestClosedOpen(timeframe, now);
  const time = {
    lte: new Date(cutoff),
    ...(options.before !== undefined && { lt: new Date(options.before * 1000) }),
    ...(options.after !== undefined && { gt: new Date(options.after * 1000) }),
  };
  const rows = await getDb().candle.findMany({
    where: { pair, timeframe, time },
    // Newest first so `limit` keeps the most recent ones; `after` (refresh) wants the oldest new ones.
    orderBy: { time: options.after !== undefined ? "asc" : "desc" },
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const candles = closedOnly(page.map(toCandle), timeframe, now).map((c) => ({
    time: Math.floor(Date.parse(c.time) / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  return { candles, hasMore: rows.length > limit };
}

async function recentClosed(pair: Pair, timeframe: ChartTimeframe, now: Date): Promise<Candle[]> {
  const rows = await getDb().candle.findMany({
    where: { pair, timeframe, time: { lte: new Date(latestClosedOpen(timeframe, now)) } },
    orderBy: { time: "desc" },
    take: LEVEL_WINDOWS[timeframe],
  });
  return closedOnly(rows.map(toCandle), timeframe, now);
}

function chartAlert(a: Alert, tag: (id: string) => StrategyTag): ChartAlertView {
  const strategy = tag(a.strategyId);
  return {
    id: a.id,
    strategy,
    isTest: strategy.mode !== "LIVE",
    status: a.status,
    direction: a.direction,
    sweepType: a.sweepType,
    sweepLevel: a.sweepLevel,
    sweepTime: a.sweepTime.toISOString(),
    readyAt: a.readyAt ? a.readyAt.toISOString() : null,
    entry: a.entry,
    stop: a.stop,
    target: a.target,
    lotSize: a.lotSize,
    stopPips: a.stopPips,
    targetPips: a.targetPips,
    entryType: a.entryType,
    paperStatus: a.paperStatus,
  };
}

/**
 * Everything the overlays need: levels computed on the server with the
 * scanner's own functions from the same stored candles, the D / 4H trend,
 * the alerts in the loaded range (`from`–`to`, UTC seconds) and the active
 * trade lines.
 */
export async function getChartContext(
  pair: Pair,
  timeframe: ChartTimeframe,
  options: { from?: number; to?: number; alertId?: string } = {},
  now = new Date(),
): Promise<ChartContext> {
  const db = getDb();
  const [D, H4, M15, settings, modeRows] = await Promise.all([
    recentClosed(pair, "D", now),
    recentClosed(pair, "H4", now),
    recentClosed(pair, "M15", now),
    db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { swingStrength: true, equalTolerancePips: true } }),
    db.strategyConfig.findMany({ select: { strategyId: true, mode: true } }),
  ]);
  const { levels, trendD, trendH4 } = computeChartLevels({ pair, D, H4, M15, settings });

  const modes = new Map<string, StrategyMode>(modeRows.map((r) => [r.strategyId, r.mode]));
  const tag = (id: string) =>
    strategyTag(id, modes, (x) => {
      try {
        const info = getStrategyInfo(x);
        return { id: x, code: info.code, name: info.name };
      } catch {
        return null;
      }
    });

  const range =
    options.from !== undefined
      ? { gte: new Date(options.from * 1000), ...(options.to !== undefined && { lte: new Date(options.to * 1000 + 86_400_000) }) }
      : undefined;
  const [inRange, open, picked] = await Promise.all([
    range ? db.alert.findMany({ where: { pair, sweepTime: range }, orderBy: { sweepTime: "asc" }, take: 300 }) : Promise.resolve([]),
    db.alert.findMany({ where: { pair, status: "READY", paperStatus: "OPEN" }, orderBy: { readyAt: "desc" }, take: 10 }),
    options.alertId ? db.alert.findFirst({ where: { id: options.alertId, pair } }) : Promise.resolve(null),
  ]);

  const activeRows = [...(picked ? [picked] : []), ...open.filter((a) => a.id !== picked?.id)].filter(
    (a) => a.entry !== null && a.stop !== null && a.target !== null,
  );
  const last = M15.at(-1);
  const change = dayChange(pair, M15);
  return {
    pair,
    timeframe,
    decimals: priceDecimals(pair),
    trendD,
    trendH4,
    levels,
    alerts: inRange.map((a) => chartAlert(a, tag)),
    active: activeRows.map((a) => chartAlert(a, tag)),
    lastClose: last?.close ?? null,
    lastCandleClose: last ? new Date(Date.parse(last.time) + 15 * 60_000).toISOString() : null,
    dayChange: change ? { openPrice: change.openPrice, changePips: change.changePips, changePct: change.changePct } : null,
    marketOpen: isMarketOpen(now),
  };
}
