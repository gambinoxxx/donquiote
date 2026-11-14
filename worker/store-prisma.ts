// Prisma implementation of the worker store (Neon).
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import type { AlertState, AlertUpdate } from "@/lib/strategy/apply-events";
import type { OpenSetup, RecentAlert, RedNewsEvent } from "@/lib/strategy/types";
import type { RecentGroup } from "@/lib/notify/plan";
import type { PushOutcome, PushTarget } from "@/lib/notify/push";
import { pairCurrencies } from "@/lib/news/types";
import { ALERT_EVENT_WINDOW_MIN, HEADLINE_WINDOW_MIN, alertNewsWarning } from "@/lib/news/warnings";
import type {
  ClosedPaperResult,
  CommitStep,
  GroupCounts,
  PendingNotification,
  HeartbeatUpdate,
  OpenPaperTrade,
  WorkerSettings,
  WorkerStore,
} from "./store";

const SETTINGS_ID = 1;

/** Another run claimed the alert between our check and our update. */
class ClaimLostError extends Error {}
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
    ...(data.entryType !== undefined && { entryType: data.entryType }),
    ...(data.entryValidUntil !== undefined && { entryValidUntil: date(data.entryValidUntil) }),
    ...(data.paperStatus !== undefined && { paperStatus: data.paperStatus }),
    ...(data.notifyState !== undefined && { notifyState: data.notifyState }),
    ...(data.paperOpenedAt !== undefined && { paperOpenedAt: date(data.paperOpenedAt) }),
  };
}

export class PrismaStore implements WorkerStore {
  private readonly db = getDb();

  async loadSettings(): Promise<WorkerSettings> {
    const s = await this.db.settings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
    return {
      strategy: {
        accountSizeUsd: s.accountSizeUsd,
        riskPct: s.riskPct,
        rewardRatio: s.rewardRatio,
        stopBufferPips: s.stopBufferPips,
        watchExpiryMinutes: s.watchExpiryMinutes,
        swingStrength: s.swingStrength,
        equalTolerancePips: s.equalTolerancePips,
      },
      paperTimeoutHours: s.paperTimeoutHours,
      pushEnabled: s.pushEnabled,
      emailEnabled: s.emailEnabled,
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

  async loadCandlesFrom(pair: Pair, timeframe: Timeframe, fromIso: string, limit: number): Promise<Candle[]> {
    const rows = await this.db.candle.findMany({
      where: { pair, timeframe, time: { gte: date(fromIso) } },
      orderBy: { time: "asc" },
      take: limit,
    });
    return rows.map((r) => ({ time: iso(r.time), open: r.open, high: r.high, low: r.low, close: r.close }));
  }

  async pairsWithOpenPaperTrades(): Promise<Pair[]> {
    const rows = await this.db.alert.findMany({
      where: { paperStatus: "OPEN" },
      distinct: ["pair"],
      select: { pair: true },
    });
    return rows.map((r) => r.pair);
  }

  async loadOpenPaperTrades(pair: Pair): Promise<OpenPaperTrade[]> {
    const rows = await this.db.alert.findMany({
      where: { pair, paperStatus: "OPEN" },
      orderBy: { paperOpenedAt: "asc" },
    });
    return rows.flatMap((a) =>
      a.entry !== null && a.stop !== null && a.target !== null && a.riskUsd !== null && a.paperOpenedAt !== null
        ? [
            {
              alertId: a.id,
              strategyId: a.strategyId,
              pair: a.pair,
              direction: a.direction,
              entry: a.entry,
              stop: a.stop,
              target: a.target,
              riskUsd: a.riskUsd,
              openedAt: iso(a.paperOpenedAt),
              ...(a.entryType === "LIMIT" && {
                entryType: "LIMIT" as const,
                ...(a.entryValidUntil !== null && { entryValidUntil: iso(a.entryValidUntil) }),
              }),
            },
          ]
        : [],
    );
  }

  async closePaperTrade(alertId: string, result: ClosedPaperResult) {
    // One statement = one transaction; guarded so a decided trade never changes.
    const { count } = await this.db.alert.updateMany({
      where: { id: alertId, paperStatus: "OPEN" },
      data: {
        paperStatus: result.status,
        paperClosedAt: date(result.closedAt),
        paperExitPrice: result.exitPrice ?? null,
        paperResultR: result.resultR,
        paperPnlUsd: result.pnlUsd,
        paperNote: result.note ?? null,
      },
    });
    return count === 1;
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

  async loadRecentAlerts(pair: Pair, strategyId: string, sinceIso: string): Promise<RecentAlert[]> {
    const rows = await this.db.alert.findMany({
      where: { pair, strategyId, sweepTime: { gte: date(sinceIso) } },
      orderBy: { sweepTime: "asc" },
    });
    return rows.map((a) => ({
      dedupeKey: a.dedupeKey,
      direction: a.direction,
      status: a.status,
      sweepType: a.sweepType,
      sweepLevel: a.sweepLevel,
      sweepTime: iso(a.sweepTime),
      ...(a.readyAt !== null && {
        readyAt: iso(a.readyAt),
        ...(a.entry !== null && { entry: a.entry }),
        ...(a.stop !== null && { stop: a.stop }),
        ...(a.target !== null && { target: a.target }),
        entryType: a.entryType,
      }),
      ...(a.entryValidUntil !== null && { entryValidUntil: iso(a.entryValidUntil) }),
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

  // --- Notification outbox ---

  async loadPendingNotifications(pair?: Pair): Promise<PendingNotification[]> {
    const rows = await this.db.alert.findMany({
      where: { notifyState: "PENDING", readyAt: { not: null }, ...(pair && { pair }) },
      orderBy: { readyAt: "asc" },
    });
    return rows.map((a) => ({
      id: a.id,
      strategyId: a.strategyId,
      pair: a.pair,
      direction: a.direction,
      readyAt: iso(a.readyAt as Date),
      claimedGroupId: a.notifyGroupId,
      content: {
        id: a.id,
        pair: a.pair,
        direction: a.direction,
        strategyIds: [a.strategyId],
        entry: a.entry ?? 0,
        stop: a.stop ?? 0,
        target: a.target ?? 0,
        lotSize: a.lotSize ?? 0,
        riskUsd: a.riskUsd ?? 0,
        sweepType: a.sweepType,
        sweepLevel: a.sweepLevel,
        bosLevel: a.bosLevel,
        entryType: a.entryType,
        readyAt: iso(a.readyAt as Date),
        entryValidUntil: a.entryValidUntil ? iso(a.entryValidUntil) : null,
      },
    }));
  }

  async loadRecentGroups(sinceIso: string): Promise<RecentGroup[]> {
    const rows = await this.db.notificationGroup.findMany({
      where: { createdAt: { gte: date(sinceIso) } },
      select: { id: true, pair: true, direction: true, createdAt: true, strategyIds: true },
    });
    return rows.map((g) => ({ ...g, createdAt: iso(g.createdAt) }));
  }

  async claimForSend(
    alertId: string,
    group: { pair: Pair; direction: "BUY" | "SELL"; strategyId: string; createdAt: string },
  ): Promise<string | null> {
    // Re-checked inside the transaction: only a PENDING, unclaimed alert is
    // claimed, so a second run (or a retry) can never send it again. Losing
    // the race rolls back the group and returns null.
    try {
      return await this.db.$transaction(async (tx) => {
        const alert = await tx.alert.findFirst({
          where: { id: alertId, notifyState: "PENDING", notifyGroupId: null },
          select: { id: true },
        });
        if (!alert) return null;
        const created = await tx.notificationGroup.create({
          data: {
            pair: group.pair,
            direction: group.direction,
            firstAlertId: alertId,
            strategyIds: [group.strategyId],
            createdAt: date(group.createdAt),
          },
        });
        const { count } = await tx.alert.updateMany({
          where: { id: alertId, notifyState: "PENDING", notifyGroupId: null },
          data: { notifyGroupId: created.id },
        });
        if (count !== 1) throw new ClaimLostError();
        return created.id;
      });
    } catch (error) {
      if (error instanceof ClaimLostError) return null;
      throw error;
    }
  }

  async finishSend(alertId: string, groupId: string, state: "SENT" | "FAILED", at: string, counts: GroupCounts) {
    await this.db.$transaction([
      this.db.alert.updateMany({
        where: { id: alertId, notifyState: "PENDING", notifyGroupId: groupId },
        data: { notifyState: state, notifiedAt: date(at) },
      }),
      this.db.notificationGroup.update({ where: { id: groupId }, data: counts }),
    ]);
  }

  async mergeIntoGroup(alertId: string, groupId: string, strategyId: string, at: string): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.alert.updateMany({
        where: { id: alertId, notifyState: "PENDING", notifyGroupId: null },
        data: { notifyState: "MERGED", notifyGroupId: groupId, notifiedAt: date(at) },
      });
      if (count !== 1) return false;
      const group = await tx.notificationGroup.findUniqueOrThrow({ where: { id: groupId }, select: { strategyIds: true } });
      if (!group.strategyIds.includes(strategyId)) {
        await tx.notificationGroup.update({
          where: { id: groupId },
          data: { strategyIds: { push: strategyId } },
        });
      }
      return true;
    });
  }

  async setNotifyState(alertId: string, state: "STALE" | "NONE" | "FAILED", at: string): Promise<boolean> {
    const { count } = await this.db.alert.updateMany({
      where: { id: alertId, notifyState: "PENDING" },
      data: { notifyState: state, ...(state !== "NONE" && { notifiedAt: date(at) }) },
    });
    return count === 1;
  }

  async loadPushTargets(): Promise<PushTarget[]> {
    return this.db.pushSubscription.findMany({
      select: { id: true, endpoint: true, p256dh: true, auth: true, failCount: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async applyPushOutcomes(outcomes: readonly PushOutcome[], at: string) {
    const ok = outcomes.filter((o) => o.result === "ok").map((o) => o.id);
    const remove = outcomes.filter((o) => o.result === "gone" || (o.result === "failed" && o.deleteNow)).map((o) => o.id);
    const failed = outcomes.filter((o) => o.result === "failed" && !o.deleteNow).map((o) => o.id);
    await this.db.$transaction([
      this.db.pushSubscription.updateMany({ where: { id: { in: ok } }, data: { failCount: 0, lastSuccessAt: date(at) } }),
      this.db.pushSubscription.deleteMany({ where: { id: { in: remove } } }),
      this.db.pushSubscription.updateMany({ where: { id: { in: failed } }, data: { failCount: { increment: 1 } } }),
    ]);
  }

  async loadNewsWarning(pair: Pair, atIso: string): Promise<string | null> {
    const at = Date.parse(atIso);
    const currencies = pairCurrencies(pair);
    const [events, headlines] = await Promise.all([
      this.db.newsEvent.findMany({
        where: { impact: "HIGH", currency: { in: currencies }, time: { gte: new Date(at - ALERT_EVENT_WINDOW_MIN * 60_000), lte: new Date(at + ALERT_EVENT_WINDOW_MIN * 60_000) } },
      }),
      this.db.headline.findMany({
        where: { impact: "HIGH", currencies: { hasSome: currencies }, publishedAt: { gte: new Date(at - HEADLINE_WINDOW_MIN * 60_000), lte: new Date(at) } },
      }),
    ]);
    const w = alertNewsWarning({
      pair,
      time: atIso,
      events: events.map((e) => ({ id: e.id, currency: e.currency, title: e.title, time: iso(e.time), forecast: e.forecast, previous: e.previous, actual: e.actual, notifiedAt: null })),
      headlines: headlines.map((h) => ({ id: h.id, source: h.source, title: h.title, url: h.url, publishedAt: iso(h.publishedAt), impact: h.impact, currencies: h.currencies, notifiedAt: null })),
    });
    return w ? w.short : null;
  }

  async loadRedNews(pair: Pair, fromIso: string, toIso: string): Promise<RedNewsEvent[]> {
    const rows = await this.db.newsEvent.findMany({
      where: { impact: "HIGH", currency: { in: pairCurrencies(pair) }, time: { gte: date(fromIso), lte: date(toIso) } },
      select: { currency: true, time: true },
      orderBy: { time: "asc" },
    });
    return rows.map((r) => ({ currency: r.currency, time: iso(r.time) }));
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
