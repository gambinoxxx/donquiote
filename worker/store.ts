// Repository interface for the worker, plus an in-memory implementation
// for tests and replays. The Prisma implementation is in store-prisma.ts.
import type { AlertStatus, Candle, Pair, Timeframe } from "@/lib/types";
import type { AlertChange, AlertState, AlertUpdate, NewAlert } from "@/lib/strategy/apply-events";
import type { StrategyModeRow } from "@/lib/strategy/modes";
import type { OpenSetup, StrategySettings } from "@/lib/strategy/types";

export type HeartbeatStatus = "ok" | "degraded" | "error";

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
  loadSettings(): Promise<StrategySettings>;
  loadEnabledPairs(): Promise<Pair[]>;
  loadStrategyModes(): Promise<StrategyModeRow[]>;

  /** Open time (ISO) of the newest stored candle, or null if none. */
  latestCandleTime(pair: Pair, timeframe: Timeframe): Promise<string | null>;
  /** The newest `limit` stored candles, oldest first. */
  loadRecentCandles(pair: Pair, timeframe: Timeframe, limit: number): Promise<Candle[]>;
  /** Inserts candles that are not stored yet; returns how many were new. */
  saveCandles(pair: Pair, timeframe: Timeframe, candles: readonly Candle[]): Promise<number>;

  /** WATCHING alerts of this strategy on this pair, as strategy setups. */
  loadOpenSetups(pair: Pair, strategyId: string): Promise<OpenSetup[]>;
  /** Existing alerts (any status) of this strategy with these keys. */
  loadAlertStates(strategyId: string, dedupeKeys: readonly string[]): Promise<AlertState[]>;

  loadCursor(pair: Pair, strategyId: string): Promise<string | null>;
  /** Applies one candle's alert changes and moves the cursor, atomically. */
  commitStep(step: CommitStep): Promise<void>;

  writeHeartbeat(update: HeartbeatUpdate): Promise<void>;
  lastCleanupAt(): Promise<string | null>;
  /** Deletes candles opened before each cutoff and records the cleanup time. */
  deleteCandlesBefore(cutoffs: Record<Timeframe, string>, cleanupAt: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export interface MemoryAlert extends NewAlert, Omit<AlertUpdate, "sweepExtreme" | "status"> {
  strategyId: string;
  status: AlertStatus;
}

export interface MemoryStoreSeed {
  settings: StrategySettings;
  enabledPairs: Pair[];
  strategyModes: StrategyModeRow[];
  candles?: Partial<Record<Pair, Partial<Record<Timeframe, Candle[]>>>>;
  cursors?: Array<{ pair: Pair; strategyId: string; lastCandleTime: string }>;
}

const key = (...parts: string[]) => parts.join("|");

export class MemoryStore implements WorkerStore {
  settings: StrategySettings;
  enabledPairs: Pair[];
  strategyModes: StrategyModeRow[];
  readonly candles = new Map<string, Candle[]>();
  readonly alerts = new Map<string, MemoryAlert>();
  readonly cursors = new Map<string, string>();
  heartbeat: HeartbeatUpdate | null = null;
  cleanupAt: string | null = null;
  /** Number of commitStep calls (one per processed candle × strategy). */
  commits = 0;

  constructor(seed: MemoryStoreSeed) {
    this.settings = seed.settings;
    this.enabledPairs = seed.enabledPairs;
    this.strategyModes = seed.strategyModes;
    for (const [pair, byTf] of Object.entries(seed.candles ?? {})) {
      for (const [tf, list] of Object.entries(byTf ?? {})) {
        this.candles.set(key(pair, tf), [...(list ?? [])]);
      }
    }
    for (const c of seed.cursors ?? []) this.cursors.set(key(c.pair, c.strategyId), c.lastCandleTime);
  }

  async loadSettings() {
    return this.settings;
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
          this.alerts.set(k, { ...change.alert, strategyId: step.strategyId, status: "WATCHING" });
        }
        continue;
      }
      const alert = this.alerts.get(key(step.strategyId, change.dedupeKey));
      if (!alert || alert.status !== change.fromStatus) continue;
      Object.assign(alert, change.data);
    }
    this.cursors.set(key(step.pair, step.strategyId), step.cursorTime);
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

  /** All alerts of one strategy (for replays and tests). */
  listAlerts(strategyId?: string): MemoryAlert[] {
    return [...this.alerts.values()].filter((a) => !strategyId || a.strategyId === strategyId);
  }
}
