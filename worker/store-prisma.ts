// Prisma implementation of the worker store (Neon).
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import type { AlertState, AlertUpdate } from "@/lib/strategy/apply-events";
import type { OpenSetup, StrategySettings } from "@/lib/strategy/types";
import type { CommitStep, HeartbeatUpdate, WorkerStore } from "./store";

const SETTINGS_ID = 1;
const HEARTBEAT_ID = 1;

const iso = (d: Date) => d.toISOString();
const date = (s: string) => new Date(s);

function updateData(data: AlertUpdate): Prisma.AlertUpdateManyMutationInput {
  return {
    ...(data.status !== undefined && { status: data.status }),
    ...(data.statusNote !== undefined && { statusNote: data.statusNote }),
    ...(data.sweepExtreme !== undefined && { sweepExtreme: data.sweepExtreme }),
    ...(data.entry !== undefined && { entry: data.entry }),
    ...(data.stop !== undefined && { stop: data.stop }),
    ...(data.target !== undefined && { target: data.target }),
    ...(data.stopPips !== undefined && { stopPips: data.stopPips }),
    ...(data.targetPips !== undefined && { targetPips: data.targetPips }),
    ...(data.lotSize !== undefined && { lotSize: data.lotSize }),
    ...(data.riskPct !== undefined && { riskPct: data.riskPct }),
    ...(data.riskUsd !== undefined && { riskUsd: data.riskUsd }),
    ...(data.readyAt !== undefined && { readyAt: date(data.readyAt) }),
    ...(data.expiredAt !== undefined && { expiredAt: date(data.expiredAt) }),
  };
}

export class PrismaStore implements WorkerStore {
  private readonly db = getDb();

  async loadSettings(): Promise<StrategySettings> {
    const s = await this.db.settings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
    return {
      accountSizeUsd: s.accountSizeUsd,
      riskPct: s.riskPct,
      rewardRatio: s.rewardRatio,
      stopBufferPips: s.stopBufferPips,
      watchExpiryMinutes: s.watchExpiryMinutes,
      swingStrength: s.swingStrength,
      equalTolerancePips: s.equalTolerancePips,
    };
  }

  async loadEnabledPairs(): Promise<Pair[]> {
    const rows = await this.db.watchlistPair.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
    });
    return rows.map((r) => r.pair);
  }

  async loadStrategyModes() {
    return this.db.strategyConfig.findMany({
      select: { strategyId: true, mode: true },
      orderBy: { strategyId: "asc" },
    });
  }

  async latestCandleTime(pair: Pair, timeframe: Timeframe) {
    const row = await this.db.candle.findFirst({
      where: { pair, timeframe },
      orderBy: { time: "desc" },
      select: { time: true },
    });
    return row ? iso(row.time) : null;
  }

  async loadRecentCandles(pair: Pair, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const rows = await this.db.candle.findMany({
      where: { pair, timeframe },
      orderBy: { time: "desc" },
      take: limit,
    });
    return rows.reverse().map((r) => ({
      time: iso(r.time),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
    }));
  }

  async saveCandles(pair: Pair, timeframe: Timeframe, candles: readonly Candle[]) {
    if (candles.length === 0) return 0;
    // Closed candles never change, so existing rows are left as they are.
    const result = await this.db.candle.createMany({
      data: candles.map((c) => ({
        pair,
        timeframe,
        time: date(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async loadOpenSetups(pair: Pair, strategyId: string): Promise<OpenSetup[]> {
    const rows = await this.db.alert.findMany({
      where: { pair, strategyId, status: "WATCHING" },
      orderBy: { sweepTime: "asc" },
    });
    return rows
      .filter((a) => a.bosLevel !== null)
      .map((a) => ({
        dedupeKey: a.dedupeKey,
        direction: a.direction,
        sweepType: a.sweepType,
        sweepLevel: a.sweepLevel,
        sweepExtreme: a.sweepExtreme,
        sweepTime: iso(a.sweepTime),
        bosLevel: a.bosLevel as number,
        expiresAt: iso(a.expiresAt),
      }));
  }

  async loadAlertStates(strategyId: string, dedupeKeys: readonly string[]): Promise<AlertState[]> {
    if (dedupeKeys.length === 0) return [];
    const rows = await this.db.alert.findMany({
      where: { strategyId, dedupeKey: { in: [...dedupeKeys] } },
      select: { dedupeKey: true, status: true, sweepExtreme: true },
    });
    return rows;
  }

  async loadCursor(pair: Pair, strategyId: string) {
    const row = await this.db.scanCursor.findUnique({
      where: { pair_strategyId: { pair, strategyId } },
    });
    return row ? iso(row.lastCandleTime) : null;
  }

  async commitStep(step: CommitStep) {
    const { pair, strategyId } = step;
    const ops: Prisma.PrismaPromise<unknown>[] = step.changes.map((change) => {
      if (change.kind === "create") {
        const a = change.alert;
        // Upsert on (strategyId, dedupeKey) with no update = idempotent create.
        return this.db.alert.upsert({
          where: { strategyId_dedupeKey: { strategyId, dedupeKey: a.dedupeKey } },
          create: {
            strategyId,
            dedupeKey: a.dedupeKey,
            pair: a.pair,
            direction: a.direction,
            status: "WATCHING",
            sweepType: a.sweepType,
            sweepLevel: a.sweepLevel,
            sweepExtreme: a.sweepExtreme,
            sweepTime: date(a.sweepTime),
            bosLevel: a.bosLevel,
            expiresAt: date(a.expiresAt),
          },
          update: {},
        });
      }
      // Guarded by the current status, so status can only move forward.
      return this.db.alert.updateMany({
        where: { strategyId, dedupeKey: change.dedupeKey, status: change.fromStatus },
        data: updateData(change.data),
      });
    });
    ops.push(
      this.db.scanCursor.upsert({
        where: { pair_strategyId: { pair, strategyId } },
        create: { pair, strategyId, lastCandleTime: date(step.cursorTime) },
        update: { lastCandleTime: date(step.cursorTime) },
      }),
    );
    await this.db.$transaction(ops);
  }

  async writeHeartbeat(update: HeartbeatUpdate) {
    const data = {
      lastScanAt: date(update.lastScanAt),
      ...(update.lastOkAt && { lastOkAt: date(update.lastOkAt) }),
      status: update.status,
      message: update.message.slice(0, 500),
      ...(update.version && { version: update.version }),
    };
    await this.db.workerHeartbeat.upsert({
      where: { id: HEARTBEAT_ID },
      create: { id: HEARTBEAT_ID, ...data },
      update: data,
    });
  }

  async lastCleanupAt() {
    const row = await this.db.workerHeartbeat.findUnique({
      where: { id: HEARTBEAT_ID },
      select: { lastCleanupAt: true },
    });
    return row?.lastCleanupAt ? iso(row.lastCleanupAt) : null;
  }

  async deleteCandlesBefore(cutoffs: Record<Timeframe, string>, cleanupAt: string) {
    const results = await this.db.$transaction([
      ...(["D", "H4", "M15"] as const).map((timeframe) =>
        this.db.candle.deleteMany({ where: { timeframe, time: { lt: date(cutoffs[timeframe]) } } }),
      ),
      this.db.workerHeartbeat.upsert({
        where: { id: HEARTBEAT_ID },
        create: { id: HEARTBEAT_ID, lastCleanupAt: date(cleanupAt) },
        update: { lastCleanupAt: date(cleanupAt) },
      }),
    ]);
    return results
      .slice(0, 3)
      .reduce((sum, r) => sum + ((r as { count: number }).count ?? 0), 0);
  }
}
