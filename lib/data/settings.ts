// Settings, strategies, watchlist and history views (Unit 13). Server-only.
import "server-only";
import { getDb } from "@/lib/db/client";
import { diff, type Change, type SettingsSnapshot } from "@/lib/settings";
import { getStrategyInfo, listStrategyInfo } from "@/lib/strategy/registry";
import { getTrend } from "@/lib/strategy/shared/trend";
import type { Candle, Pair } from "@/lib/types";
import { closedOnly, LEVEL_WINDOWS } from "./chart-logic";
import { scoreboard, strategyTag } from "./logic";
import { summarizePaper } from "@/lib/paper/summary";
import { LATEST_VERSION, loadSnapshot, restoreTarget, type SettingsTx } from "./settings-store";
import type { HistoryPage, SettingsPageData, StrategiesPageData, StrategyMode, WatchlistPageData } from "./types";

export const HISTORY_PAGE_SIZE = 20;

const who = (email: string) => (email === "system" ? "system" : (email.split("@")[0] ?? email));

function strategyName(id: string): string {
  try {
    return getStrategyInfo(id).name;
  } catch {
    return id;
  }
}

async function latestVersionId(): Promise<string | null> {
  const v = await getDb().settingsVersion.findFirst(LATEST_VERSION as never);
  return (v as { id: string } | null)?.id ?? null;
}

async function currentSnapshot(): Promise<SettingsSnapshot> {
  return loadSnapshot(getDb() as unknown as SettingsTx);
}

export async function getSettingsPage(): Promise<SettingsPageData> {
  const db = getDb();
  const [snapshot, last] = await Promise.all([
    currentSnapshot(),
    db.settingsVersion.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, createdAt: true, createdBy: true } }),
  ]);
  return {
    snapshot,
    versionId: last?.id ?? null,
    lastChange: last ? { at: last.createdAt.toISOString(), by: who(last.createdBy) } : null,
    liveCount: snapshot.strategies.filter((s) => s.mode === "LIVE").length,
    testCount: snapshot.strategies.filter((s) => s.mode === "TEST").length,
    pairsOn: snapshot.watchlist.filter((w) => w.enabled).length,
    pairsTotal: snapshot.watchlist.length,
  };
}

export async function getStrategiesPage(): Promise<StrategiesPageData> {
  const db = getDb();
  const [modeRows, paperRows, versionId] = await Promise.all([
    db.strategyConfig.findMany({ select: { strategyId: true, mode: true } }),
    db.alert.findMany({
      where: { paperStatus: { not: null } },
      select: { strategyId: true, paperStatus: true, paperClosedAt: true, paperResultR: true, paperPnlUsd: true },
    }),
    latestVersionId(),
  ]);
  const modes = new Map<string, StrategyMode>(modeRows.map((r) => [r.strategyId, r.mode]));
  const rows = paperRows.map((r) => ({
    strategyId: r.strategyId,
    paperStatus: r.paperStatus as NonNullable<typeof r.paperStatus>,
    paperClosedAt: r.paperClosedAt ? r.paperClosedAt.toISOString() : null,
    paperResultR: r.paperResultR,
    paperPnlUsd: r.paperPnlUsd,
  }));
  const streaks = new Map(summarizePaper(rows).map((s) => [s.strategyId, s.worstLosingStreak]));
  const infos = listStrategyInfo();
  const tags = infos.map((info) => strategyTag(info.id, modes, () => ({ id: info.id, code: info.code, name: info.name })));
  // Scoreboard rows for every strategy, OFF included (the screen shows all of them).
  const board = new Map(scoreboard(tags.map((t) => ({ ...t, mode: t.mode === "OFF" ? ("TEST" as const) : t.mode })), rows).map((r) => [r.strategy.id, r]));
  return {
    versionId,
    strategies: infos.map((info, i) => {
      const tag = tags[i] as (typeof tags)[number];
      const paper = board.get(info.id);
      return {
        id: info.id,
        code: info.code,
        name: info.name,
        description: info.description,
        rules: info.rules.map((r) => r.text),
        mode: tag.mode,
        paper: { ...(paper as NonNullable<typeof paper>), strategy: tag },
        worstLosingStreak: streaks.get(info.id) ?? 0,
      };
    }),
  };
}

export async function getWatchlistPage(now = new Date()): Promise<WatchlistPageData> {
  const db = getDb();
  const [rows, open, settings, versionId] = await Promise.all([
    db.watchlistPair.findMany({ orderBy: { sortOrder: "asc" } }),
    db.alert.groupBy({ by: ["pair"], where: { paperStatus: "OPEN" }, _count: true }),
    db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { swingStrength: true } }),
    latestVersionId(),
  ]);
  const openBy = new Map(open.map((o) => [o.pair, o._count]));
  const recent = async (pair: Pair, timeframe: "D" | "H4") => {
    const list = await db.candle.findMany({ where: { pair, timeframe }, orderBy: { time: "desc" }, take: LEVEL_WINDOWS[timeframe] });
    const candles: Candle[] = list.map((c) => ({ time: c.time.toISOString(), open: c.open, high: c.high, low: c.low, close: c.close }));
    return closedOnly(candles, timeframe, now);
  };
  const pairs = await Promise.all(
    rows.map(async (r) => {
      const [D, H4] = await Promise.all([recent(r.pair, "D"), recent(r.pair, "H4")]);
      return {
        pair: r.pair,
        enabled: r.enabled,
        trendD: getTrend(D, settings.swingStrength),
        trendH4: getTrend(H4, settings.swingStrength),
        openPaperTrades: openBy.get(r.pair) ?? 0,
      };
    }),
  );
  return { pairs, versionId };
}

/** Versions newest first, 20 per page; each row shows what Restore would change now. */
export async function getHistoryPage(cursor?: string | null): Promise<HistoryPage> {
  const db = getDb();
  const [current, versionId, rows] = await Promise.all([
    currentSnapshot(),
    latestVersionId(),
    db.settingsVersion.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_PAGE_SIZE + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    }),
  ]);
  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  const restoredIds = page.map((r) => r.restoredFromId).filter((x): x is string => x !== null);
  const restored = restoredIds.length
    ? await db.settingsVersion.findMany({ where: { id: { in: restoredIds } }, select: { id: true, createdAt: true } })
    : [];
  return {
    versionId,
    nextCursor: rows.length > HISTORY_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    rows: page.map((r) => {
      const isCurrent = r.id === versionId;
      const from = restored.find((x) => x.id === r.restoredFromId);
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        by: who(r.createdBy),
        changes: (r.changes as unknown as Change[]) ?? [],
        restoredFrom: from ? { id: from.id, createdAt: from.createdAt.toISOString() } : r.restoredFromId ? { id: r.restoredFromId, createdAt: "" } : null,
        current: isCurrent,
        restorePreview: isCurrent ? [] : diff(current, restoreTarget(current, r.snapshot as unknown as SettingsSnapshot), strategyName),
      };
    }),
  };
}
