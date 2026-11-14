// Repository interface for the worker, plus an in-memory implementation
// for tests and replays. The Prisma implementation is in store-prisma.ts.
import type { AlertStatus, Candle, Pair, Timeframe } from "@/lib/types";
import type { NotifyContent } from "@/lib/notify/format";
import type { RecentGroup } from "@/lib/notify/plan";
import type { PushOutcome, PushTarget } from "@/lib/notify/push";
import type { PaperResult, PaperTrade } from "@/lib/paper/resolve";
import type { AlertChange, AlertState, AlertUpdate, NewAlert } from "@/lib/strategy/apply-events";
import type { StrategyModeRow } from "@/lib/strategy/modes";
import type { OpenSetup, RecentAlert, RedNewsEvent, StrategySettings } from "@/lib/strategy/types";

export type HeartbeatStatus = "ok" | "degraded" | "error";

/** Settings default for the paper trade time limit (architecture.md, Unit 8). */
export const DEFAULT_PAPER_TIMEOUT_HOURS = 72;

/** The Settings row as the worker needs it. */
export interface WorkerSettings {
  strategy: StrategySettings;
  /** Paper trade time limit in market hours; × 4 = M15 candles. */
  paperTimeoutHours: number;
  /** Settings › Notifications toggles. */
  pushEnabled: boolean;
  emailEnabled: boolean;
}

/** Final notify states the worker writes (PENDING is written with READY). */
export type NotifyOutcomeState = "SENT" | "MERGED" | "STALE" | "FAILED" | "NONE";

/** A READY alert waiting in the notification outbox (notifyState = PENDING). */
export interface PendingNotification {
  id: string;
  strategyId: string;
  pair: Pair;
  direction: "BUY" | "SELL";
  /** ISO, UTC. */
  readyAt: string;
  /** Set if a previous run claimed it for sending and never finished. */
  claimedGroupId: string | null;
  content: NotifyContent;
}

export interface GroupCounts {
  pushSent: number;
  pushFailed: number;
  emailSent: number;
  emailFailed: number;
}

/** An OPEN paper trade, with the ticket stored on its alert. */
export interface OpenPaperTrade extends PaperTrade {
  alertId: string;
  strategyId: string;
}

/** A decided paper trade result (anything but OPEN). NOT_FILLED has no exit price. */
export type ClosedPaperResult = Required<Pick<PaperResult, "closedAt" | "resultR" | "pnlUsd">> & {
  status: Exclude<PaperResult["status"], "OPEN">;
  exitPrice?: number;
  note?: string;
};

export interface HeartbeatUpdate {
  lastScanAt: string;
  /** Set only when every pair succeeded. */
  lastOkAt?: string;
  status: HeartbeatStatus;
  message: string;
  version?: string;
}

export interface CommitStep {
  pair: Pair;
  strategyId: string;
  changes: readonly AlertChange[];
  /** Open time (ISO) of the M15 candle just processed. */
  cursorTime: string;
}

export interface WorkerStore {
  loadSettings(): Promise<WorkerSettings>;
  loadEnabledPairs(): Promise<Pair[]>;
  loadStrategyModes(): Promise<StrategyModeRow[]>;

  /** Open time (ISO) of the newest stored candle, or null if none. */
  latestCandleTime(pair: Pair, timeframe: Timeframe): Promise<string | null>;
  /** The newest `limit` stored candles, oldest first. */
  loadRecentCandles(pair: Pair, timeframe: Timeframe, limit: number): Promise<Candle[]>;
  /** Inserts candles that are not stored yet; returns how many were new. */
  saveCandles(pair: Pair, timeframe: Timeframe, candles: readonly Candle[]): Promise<number>;
  /** Up to `limit` stored candles opened at or after `fromIso`, oldest first. */
  loadCandlesFrom(pair: Pair, timeframe: Timeframe, fromIso: string, limit: number): Promise<Candle[]>;

  /** WATCHING alerts of this strategy on this pair, as strategy setups. */
  loadOpenSetups(pair: Pair, strategyId: string): Promise<OpenSetup[]>;
  /** Existing alerts (any status) of this strategy with these keys. */
  loadAlertStates(strategyId: string, dedupeKeys: readonly string[]): Promise<AlertState[]>;
  /** This strategy's alerts on this pair with a sweep at or after `sinceIso`, oldest first. */
  loadRecentAlerts(pair: Pair, strategyId: string, sinceIso: string): Promise<RecentAlert[]>;

  /** Pairs with at least one OPEN paper trade (any strategy, any mode). */
  pairsWithOpenPaperTrades(): Promise<Pair[]>;
  /** OPEN paper trades on this pair, from every strategy (OFF included), oldest first. */
  loadOpenPaperTrades(pair: Pair): Promise<OpenPaperTrade[]>;
  /**
   * Saves a result in one write, only if the trade is still OPEN (results
   * only move forward). Returns false if it was already closed.
   */
  closePaperTrade(alertId: string, result: ClosedPaperResult): Promise<boolean>;

  loadCursor(pair: Pair, strategyId: string): Promise<string | null>;
  /** Applies one candle's alert changes and moves the cursor, atomically. */
  commitStep(step: CommitStep): Promise<void>;

  // --- Notification outbox (Unit 10) ---
  /** PENDING alerts (all pairs, or one), oldest READY first. */
  loadPendingNotifications(pair?: Pair): Promise<PendingNotification[]>;
  /** Notification groups created at or after `sinceIso`. */
  loadRecentGroups(sinceIso: string): Promise<RecentGroup[]>;
  /**
   * In one transaction: if the alert is still PENDING and unclaimed, create
   * its group and claim the alert for it. Returns the group id, or null if
   * another run got there first (so it is never sent twice).
   */
  claimForSend(
    alertId: string,
    group: { pair: Pair; direction: "BUY" | "SELL"; strategyId: string; createdAt: string },
  ): Promise<string | null>;
  /** Records the outcome of a claimed send (SENT or FAILED) and the group's counts. */
  finishSend(alertId: string, groupId: string, state: "SENT" | "FAILED", at: string, counts: GroupCounts): Promise<void>;
  /** PENDING → MERGED into the group (strategy added to it). False if no longer PENDING. */
  mergeIntoGroup(alertId: string, groupId: string, strategyId: string, at: string): Promise<boolean>;
  /** PENDING → STALE / NONE / FAILED. False if no longer PENDING. */
  setNotifyState(alertId: string, state: "STALE" | "NONE" | "FAILED", at: string): Promise<boolean>;
  /** Every push subscription (all devices of all allowed users). */
  loadPushTargets(): Promise<PushTarget[]>;
  /** ok → failCount 0 + lastSuccessAt; gone or 5th failure → delete; failed → failCount + 1. */
  applyPushOutcomes(outcomes: readonly PushOutcome[], at: string): Promise<void>;

  writeHeartbeat(update: HeartbeatUpdate): Promise<void>;
  /** Unit 15: the short news warning for an alert at `atIso` on `pair`, or null. */
  loadNewsWarning(pair: Pair, atIso: string): Promise<string | null>;
  /**
   * Unit 17: stored red (HIGH) calendar events for either currency of the
   * pair with a time in [fromIso, toIso], oldest first. For strategies with
   * a news rule (london-break).
   */
  loadRedNews(pair: Pair, fromIso: string, toIso: string): Promise<RedNewsEvent[]>;
  lastCleanupAt(): Promise<string | null>;
  /** Deletes candles opened before each cutoff and records the cleanup time. */
  deleteCandlesBefore(cutoffs: Record<Timeframe, string>, cleanupAt: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export interface MemoryAlert
  extends NewAlert,
    Omit<AlertUpdate, "sweepExtreme" | "status" | "paperStatus" | "notifyState"> {
  id: string;
  strategyId: string;
  status: AlertStatus;
  notifyState?: "NONE" | "PENDING" | NotifyOutcomeState;
  notifyGroupId?: string;
  notifiedAt?: string;
  paperStatus?: PaperResult["status"];
  paperClosedAt?: string;
  paperExitPrice?: number;
  paperResultR?: number;
  paperPnlUsd?: number;
  paperNote?: string;
}

export interface MemoryGroup extends RecentGroup {
  firstAlertId: string;
  strategyIds: string[];
  counts: GroupCounts;
}

export interface MemorySubscription extends PushTarget {
  userEmail: string;
  lastSuccessAt?: string;
}

export interface MemoryStoreSeed {
  settings: StrategySettings;
  paperTimeoutHours?: number;
  pushEnabled?: boolean;
  emailEnabled?: boolean;
  subscriptions?: MemorySubscription[];
  enabledPairs: Pair[];
  strategyModes: StrategyModeRow[];
  candles?: Partial<Record<Pair, Partial<Record<Timeframe, Candle[]>>>>;
  cursors?: Array<{ pair: Pair; strategyId: string; lastCandleTime: string }>;
}

const key = (...parts: string[]) => parts.join("|");

function toRecentAlert(a: MemoryAlert): RecentAlert {
  return {
    dedupeKey: a.dedupeKey,
    direction: a.direction,
    status: a.status,
    sweepType: a.sweepType,
    sweepLevel: a.sweepLevel,
    sweepTime: a.sweepTime,
    ...(a.readyAt !== undefined && {
      readyAt: a.readyAt,
      entry: a.entry,
      stop: a.stop,
      target: a.target,
      entryType: a.entryType ?? "MARKET",
    }),
    ...(a.entryValidUntil !== undefined && { entryValidUntil: a.entryValidUntil }),
  };
}

export class MemoryStore implements WorkerStore {
  /** Unit 15: what loadNewsWarning returns (tests set it). */
  newsWarning: string | null = null;
  async loadNewsWarning(): Promise<string | null> {
    return this.newsWarning;
  }
  /** Unit 17: red calendar events loadRedNews filters (tests set it; replays leave it empty). */
  redNews: RedNewsEvent[] = [];
  async loadRedNews(pair: Pair, fromIso: string, toIso: string): Promise<RedNewsEvent[]> {
    const currencies = pair.split("_");
    return this.redNews
      .filter((e) => currencies.includes(e.currency) && e.time >= fromIso && e.time <= toIso)
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  settings: StrategySettings;
  paperTimeoutHours: number;
  pushEnabled: boolean;
  emailEnabled: boolean;
  readonly groups = new Map<string, MemoryGroup>();
  subscriptions: MemorySubscription[];
  enabledPairs: Pair[];
  strategyModes: StrategyModeRow[];
  readonly candles = new Map<string, Candle[]>();
  readonly alerts = new Map<string, MemoryAlert>();
  readonly cursors = new Map<string, string>();
  heartbeat: HeartbeatUpdate | null = null;
  cleanupAt: string | null = null;
  /** Number of commitStep calls (one per processed candle × strategy). */
  commits = 0;
  /** Number of closePaperTrade calls that saved a result. */
  paperCloses = 0;
  private nextAlertId = 1;

  constructor(seed: MemoryStoreSeed) {
    this.settings = seed.settings;
    this.paperTimeoutHours = seed.paperTimeoutHours ?? DEFAULT_PAPER_TIMEOUT_HOURS;
    this.pushEnabled = seed.pushEnabled ?? true;
    this.emailEnabled = seed.emailEnabled ?? true;
    this.subscriptions = [...(seed.subscriptions ?? [])];
    this.enabledPairs = seed.enabledPairs;
    this.strategyModes = seed.strategyModes;
    for (const [pair, byTf] of Object.entries(seed.candles ?? {})) {
      for (const [tf, list] of Object.entries(byTf ?? {})) {
        this.candles.set(key(pair, tf), [...(list ?? [])]);
      }
    }
    for (const c of seed.cursors ?? []) this.cursors.set(key(c.pair, c.strategyId), c.lastCandleTime);
  }

  async loadSettings(): Promise<WorkerSettings> {
    return {
      strategy: this.settings,
      paperTimeoutHours: this.paperTimeoutHours,
      pushEnabled: this.pushEnabled,
      emailEnabled: this.emailEnabled,
    };
  }
  async loadEnabledPairs() {
    return this.enabledPairs;
  }
  async loadStrategyModes() {
    return this.strategyModes;
  }

  async latestCandleTime(pair: Pair, timeframe: Timeframe) {
    return this.candles.get(key(pair, timeframe))?.at(-1)?.time ?? null;
  }

  async loadRecentCandles(pair: Pair, timeframe: Timeframe, limit: number) {
    const list = this.candles.get(key(pair, timeframe)) ?? [];
    return list.slice(Math.max(0, list.length - limit));
  }

  async saveCandles(pair: Pair, timeframe: Timeframe, incoming: readonly Candle[]) {
    const k = key(pair, timeframe);
    const list = this.candles.get(k) ?? [];
    const last = list.at(-1)?.time;
    // Fast path: strictly newer candles in order (the normal live case).
    const fresh = incoming.filter((c) => last === undefined || c.time > last);
    if (fresh.length === incoming.length || last === undefined) {
      const sorted = [...fresh].sort((a, b) => a.time.localeCompare(b.time));
      const deduped = sorted.filter((c, i) => i === 0 || c.time !== sorted[i - 1]?.time);
      list.push(...deduped);
      this.candles.set(k, list);
      return deduped.length;
    }
    const byTime = new Map(list.map((c) => [c.time, c]));
    let added = 0;
    for (const c of incoming) {
      if (!byTime.has(c.time)) {
        byTime.set(c.time, c);
        added++;
      }
    }
    this.candles.set(k, [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time)));
    return added;
  }

  async loadCandlesFrom(pair: Pair, timeframe: Timeframe, fromIso: string, limit: number) {
    const list = this.candles.get(key(pair, timeframe)) ?? [];
    const start = list.findIndex((c) => c.time >= fromIso);
    return start === -1 ? [] : list.slice(start, start + limit);
  }

  async pairsWithOpenPaperTrades(): Promise<Pair[]> {
    const pairs = new Set<Pair>();
    for (const a of this.alerts.values()) if (a.paperStatus === "OPEN") pairs.add(a.pair);
    return [...pairs];
  }

  async loadOpenPaperTrades(pair: Pair): Promise<OpenPaperTrade[]> {
    return [...this.alerts.values()]
      .filter((a) => a.pair === pair && a.paperStatus === "OPEN")
      .flatMap((a) =>
        a.entry !== undefined &&
        a.stop !== undefined &&
        a.target !== undefined &&
        a.riskUsd !== undefined &&
        a.paperOpenedAt !== undefined
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
                openedAt: a.paperOpenedAt,
                ...(a.entryType === "LIMIT" && {
                  entryType: "LIMIT" as const,
                  ...(a.entryValidUntil !== undefined && { entryValidUntil: a.entryValidUntil }),
                }),
              },
            ]
          : [],
      )
      .sort((x, y) => x.openedAt.localeCompare(y.openedAt));
  }

  async closePaperTrade(alertId: string, result: ClosedPaperResult) {
    const alert = [...this.alerts.values()].find((a) => a.id === alertId);
    if (!alert || alert.paperStatus !== "OPEN") return false;
    alert.paperStatus = result.status;
    alert.paperClosedAt = result.closedAt;
    if (result.exitPrice !== undefined) alert.paperExitPrice = result.exitPrice;
    alert.paperResultR = result.resultR;
    alert.paperPnlUsd = result.pnlUsd;
    if (result.note !== undefined) alert.paperNote = result.note;
    this.paperCloses++;
    return true;
  }

  async loadOpenSetups(pair: Pair, strategyId: string): Promise<OpenSetup[]> {
    return [...this.alerts.values()]
      .filter((a) => a.strategyId === strategyId && a.pair === pair && a.status === "WATCHING")
      .sort((a, b) => a.sweepTime.localeCompare(b.sweepTime))
      .map((a) => ({
        dedupeKey: a.dedupeKey,
        direction: a.direction,
        sweepType: a.sweepType,
        sweepLevel: a.sweepLevel,
        sweepExtreme: a.sweepExtreme,
        sweepTime: a.sweepTime,
        bosLevel: a.bosLevel,
        expiresAt: a.expiresAt,
      }));
  }

  async loadRecentAlerts(pair: Pair, strategyId: string, sinceIso: string): Promise<RecentAlert[]> {
    return [...this.alerts.values()]
      .filter((a) => a.strategyId === strategyId && a.pair === pair && a.sweepTime >= sinceIso)
      .sort((a, b) => a.sweepTime.localeCompare(b.sweepTime))
      .map(toRecentAlert);
  }

  async loadAlertStates(strategyId: string, dedupeKeys: readonly string[]) {
    return dedupeKeys
      .map((k) => this.alerts.get(key(strategyId, k)))
      .filter((a): a is MemoryAlert => a !== undefined)
      .map((a) => ({ dedupeKey: a.dedupeKey, status: a.status, sweepExtreme: a.sweepExtreme }));
  }

  async loadCursor(pair: Pair, strategyId: string) {
    return this.cursors.get(key(pair, strategyId)) ?? null;
  }

  async commitStep(step: CommitStep) {
    this.commits++;
    for (const change of step.changes) {
      if (change.kind === "create") {
        const k = key(step.strategyId, change.alert.dedupeKey);
        if (!this.alerts.has(k)) {
          this.alerts.set(k, {
            ...change.alert,
            id: `alert-${this.nextAlertId++}`,
            strategyId: step.strategyId,
            status: "WATCHING",
          });
        }
        continue;
      }
      const alert = this.alerts.get(key(step.strategyId, change.dedupeKey));
      if (!alert || alert.status !== change.fromStatus) continue;
      Object.assign(alert, change.data);
    }
    this.cursors.set(key(step.pair, step.strategyId), step.cursorTime);
  }

  // --- Notification outbox ---

  private alertById(id: string): MemoryAlert | undefined {
    return [...this.alerts.values()].find((a) => a.id === id);
  }

  async loadPendingNotifications(pair?: Pair): Promise<PendingNotification[]> {
    return [...this.alerts.values()]
      .filter((a) => a.notifyState === "PENDING" && (!pair || a.pair === pair) && a.readyAt !== undefined)
      .sort((a, b) => (a.readyAt ?? "").localeCompare(b.readyAt ?? ""))
      .map((a) => ({
        id: a.id,
        strategyId: a.strategyId,
        pair: a.pair,
        direction: a.direction,
        readyAt: a.readyAt as string,
        claimedGroupId: a.notifyGroupId ?? null,
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
          entryType: a.entryType ?? "MARKET",
          readyAt: a.readyAt as string,
          entryValidUntil: a.entryValidUntil ?? null,
        },
      }));
  }

  async loadRecentGroups(sinceIso: string): Promise<RecentGroup[]> {
    return [...this.groups.values()].filter((g) => g.createdAt >= sinceIso).map((g) => ({ ...g }));
  }

  async claimForSend(
    alertId: string,
    group: { pair: Pair; direction: "BUY" | "SELL"; strategyId: string; createdAt: string },
  ) {
    const alert = this.alertById(alertId);
    if (!alert || alert.notifyState !== "PENDING" || alert.notifyGroupId) return null;
    const id = `group-${this.groups.size + 1}`;
    this.groups.set(id, {
      id,
      pair: group.pair,
      direction: group.direction,
      createdAt: group.createdAt,
      firstAlertId: alertId,
      strategyIds: [group.strategyId],
      counts: { pushSent: 0, pushFailed: 0, emailSent: 0, emailFailed: 0 },
    });
    alert.notifyGroupId = id;
    return id;
  }

  async finishSend(alertId: string, groupId: string, state: "SENT" | "FAILED", at: string, counts: GroupCounts) {
    const alert = this.alertById(alertId);
    if (alert?.notifyState === "PENDING" && alert.notifyGroupId === groupId) {
      alert.notifyState = state;
      alert.notifiedAt = at;
    }
    const group = this.groups.get(groupId);
    if (group) group.counts = counts;
  }

  async mergeIntoGroup(alertId: string, groupId: string, strategyId: string, at: string) {
    const alert = this.alertById(alertId);
    const group = this.groups.get(groupId);
    if (!alert || !group || alert.notifyState !== "PENDING" || alert.notifyGroupId) return false;
    alert.notifyState = "MERGED";
    alert.notifyGroupId = groupId;
    alert.notifiedAt = at;
    if (!group.strategyIds.includes(strategyId)) group.strategyIds.push(strategyId);
    return true;
  }

  async setNotifyState(alertId: string, state: "STALE" | "NONE" | "FAILED", at: string) {
    const alert = this.alertById(alertId);
    if (!alert || alert.notifyState !== "PENDING") return false;
    alert.notifyState = state;
    if (state !== "NONE") alert.notifiedAt = at;
    return true;
  }

  async loadPushTargets(): Promise<PushTarget[]> {
    return this.subscriptions.map(({ id, endpoint, p256dh, auth, failCount }) => ({ id, endpoint, p256dh, auth, failCount }));
  }

  async applyPushOutcomes(outcomes: readonly PushOutcome[], at: string) {
    for (const o of outcomes) {
      const sub = this.subscriptions.find((s) => s.id === o.id);
      if (!sub) continue;
      if (o.result === "ok") {
        sub.failCount = 0;
        sub.lastSuccessAt = at;
      } else if (o.result === "gone" || o.deleteNow) {
        this.subscriptions = this.subscriptions.filter((s) => s.id !== o.id);
      } else {
        sub.failCount += 1;
      }
    }
  }

  async writeHeartbeat(update: HeartbeatUpdate) {
    this.heartbeat = { ...(this.heartbeat ?? {}), ...update };
  }

  async lastCleanupAt() {
    return this.cleanupAt;
  }

  async deleteCandlesBefore(cutoffs: Record<Timeframe, string>, cleanupAt: string) {
    let deleted = 0;
    for (const [k, list] of this.candles) {
      const tf = k.split("|")[1] as Timeframe;
      const kept = list.filter((c) => c.time >= cutoffs[tf]);
      deleted += list.length - kept.length;
      this.candles.set(k, kept);
    }
    this.cleanupAt = cleanupAt;
    return deleted;
  }

  /** Inserts an alert directly (tests and replays). */
  putAlert(alert: Omit<MemoryAlert, "id">): MemoryAlert {
    const stored: MemoryAlert = { ...alert, id: `alert-${this.nextAlertId++}` };
    this.alerts.set(key(alert.strategyId, alert.dedupeKey), stored);
    return stored;
  }

  /** All alerts of one strategy (for replays and tests). */
  listAlerts(strategyId?: string): MemoryAlert[] {
    return [...this.alerts.values()].filter((a) => !strategyId || a.strategyId === strategyId);
  }
}
