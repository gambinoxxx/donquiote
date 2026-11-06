// One scan cycle: read config → sync candles per pair → run every LIVE and
// TEST strategy over the new closed M15 candles, one at a time, oldest
// first (same input as the backtester) → heartbeat → daily cleanup.
// Paper trades (Unit 8) and notifications (Unit 10) plug in later.
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { TIMEFRAME_MS } from "@/lib/market/time";
import { applyEvents, planAlertChanges } from "@/lib/strategy/apply-events";
import { activeStrategies, type StrategyModeRow } from "@/lib/strategy/modes";
import { getStrategy as registryGetStrategy } from "@/lib/strategy/registry";
import { buildInputAt, STRATEGY_WINDOWS } from "@/lib/strategy/replay";
import type { SetupEvent, Strategy, StrategySettings } from "@/lib/strategy/types";
import { describeError, silentLogger, type Logger } from "./log";
import type { PriceSource } from "./prices";
import type { HeartbeatStatus, WorkerStore } from "./store";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TIMEFRAMES: readonly Timeframe[] = ["D", "H4", "M15"];

/** At most this much missed history is replayed after downtime. */
export const CATCH_UP_LIMIT_MS = 48 * HOUR_MS;

/** Candle retention (architecture.md → Storage Model); also the first-run backfill. */
export const RETENTION_MS: Record<Timeframe, number> = {
  M15: 90 * DAY_MS,
  H4: 365 * DAY_MS,
  D: 365 * DAY_MS,
};

/** Stored candles loaded per pair each cycle: strategy window + catch-up + slack. */
export const LOAD_LIMITS: Record<Timeframe, number> = {
  D: STRATEGY_WINDOWS.D + Math.ceil(CATCH_UP_LIMIT_MS / TIMEFRAME_MS.D) + 10,
  H4: STRATEGY_WINDOWS.H4 + Math.ceil(CATCH_UP_LIMIT_MS / TIMEFRAME_MS.H4) + 10,
  M15: STRATEGY_WINDOWS.M15 + Math.ceil(CATCH_UP_LIMIT_MS / TIMEFRAME_MS.M15) + 10,
};

export interface CycleDeps {
  store: WorkerStore;
  prices: PriceSource;
  now: Date;
  logger?: Logger;
  /** Defaults to the registry. */
  getStrategy?: (id: string) => Strategy;
  version?: string;
}

export interface StrategyRunReport {
  strategyId: string;
  ok: boolean;
  candles: number;
  skippedOld: number;
  events: Record<SetupEvent["type"], number>;
  changes: number;
}

export interface PairReport {
  pair: Pair;
  ok: boolean;
  savedCandles: Record<Timeframe, number>;
  strategies: StrategyRunReport[];
  error?: string;
}

export interface CycleReport {
  startedAt: string;
  status: HeartbeatStatus;
  message: string;
  pairs: PairReport[];
  cleanedCandles?: number;
  ms: number;
}

const emptyEvents = (): Record<SetupEvent["type"], number> => ({
  SWEEP: 0,
  EXTEND: 0,
  CONFIRM: 0,
  EXPIRE: 0,
  SKIP_INVALID: 0,
});

const errorMessage = describeError;

// --- Step 1: config --------------------------------------------------------

interface CycleConfig {
  settings: StrategySettings;
  pairs: Pair[];
  strategies: Array<{ mode: StrategyModeRow["mode"]; strategy: Strategy }>;
  problems: string[];
}

export async function readConfig(
  store: WorkerStore,
  getStrategy: (id: string) => Strategy,
): Promise<CycleConfig> {
  const [settings, pairs, modes] = await Promise.all([
    store.loadSettings(),
    store.loadEnabledPairs(),
    store.loadStrategyModes(),
  ]);
  const problems: string[] = [];
  const strategies: CycleConfig["strategies"] = [];
  for (const row of activeStrategies(modes)) {
    try {
      strategies.push({ mode: row.mode, strategy: getStrategy(row.strategyId) });
    } catch {
      problems.push(`unknown strategy "${row.strategyId}" skipped`);
    }
  }
  if (!strategies.some((s) => s.mode === "LIVE")) problems.push("no LIVE strategy");
  return { settings, pairs, strategies, problems };
}

// --- Step 2: candles -------------------------------------------------------

/** Fetches everything since the newest stored candle (or backfills) and saves it. */
export async function syncCandles(
  deps: Pick<CycleDeps, "store" | "prices" | "now">,
  pair: Pair,
): Promise<Record<Timeframe, number>> {
  const saved: Record<Timeframe, number> = { D: 0, H4: 0, M15: 0 };
  for (const timeframe of TIMEFRAMES) {
    const latest = await deps.store.latestCandleTime(pair, timeframe);
    const from = latest ?? new Date(deps.now.getTime() - RETENTION_MS[timeframe]).toISOString();
    const candles = await deps.prices.fetchClosedSince(pair, timeframe, from, deps.now);
    saved[timeframe] = await deps.store.saveCandles(pair, timeframe, candles);
  }
  return saved;
}

async function loadPairCandles(store: WorkerStore, pair: Pair) {
  const [D, H4, M15] = await Promise.all(
    TIMEFRAMES.map((tf) => store.loadRecentCandles(pair, tf, LOAD_LIMITS[tf])),
  );
  return { D: D ?? [], H4: H4 ?? [], M15: M15 ?? [] };
}

// --- Step 3: strategies ----------------------------------------------------

/**
 * Indices of the M15 candles this strategy still has to process: those
 * after its cursor (only the latest on a first run), at most 48 h back.
 */
export function pendingCandleIndices(
  m15: readonly Candle[],
  cursor: string | null,
): { indices: number[]; skippedOld: number } {
  const latest = m15.at(-1);
  if (!latest) return { indices: [], skippedOld: 0 };
  if (cursor === null) return { indices: [m15.length - 1], skippedOld: 0 };

  const oldestAllowed = new Date(Date.parse(latest.time) - CATCH_UP_LIMIT_MS).toISOString();
  const indices: number[] = [];
  let skippedOld = 0;
  m15.forEach((candle, i) => {
    if (candle.time <= cursor) return;
    if (candle.time < oldestAllowed) skippedOld++;
    else indices.push(i);
  });
  return { indices, skippedOld };
}

/** Runs one strategy over a pair's pending candles, committing after each. */
export async function scanPairStrategy(args: {
  store: WorkerStore;
  pair: Pair;
  strategy: Strategy;
  settings: StrategySettings;
  candles: { D: readonly Candle[]; H4: readonly Candle[]; M15: readonly Candle[] };
  logger: Logger;
}): Promise<StrategyRunReport> {
  const { store, pair, strategy, settings, candles, logger } = args;
  const report: StrategyRunReport = {
    strategyId: strategy.id,
    ok: true,
    candles: 0,
    skippedOld: 0,
    events: emptyEvents(),
    changes: 0,
  };

  const cursor = await store.loadCursor(pair, strategy.id);
  const { indices, skippedOld } = pendingCandleIndices(candles.M15, cursor);
  report.skippedOld = skippedOld;
  if (skippedOld > 0) {
    logger({
      component: "cycle",
      pair,
      strategy: strategy.id,
      outcome: "catch_up_limited",
      skipped: skippedOld,
      message: `skipped ${skippedOld} M15 candles older than 48 h after the cursor`,
    });
  }

  // Open setups are loaded once, then carried forward in memory with
  // applyEvents — exactly like the backtester. Only this worker writes
  // WATCHING alerts, so memory and database stay in step.
  let openSetups = indices.length > 0 ? await store.loadOpenSetups(pair, strategy.id) : [];
  // A candle with no events only moves the cursor; that write is deferred
  // (reprocessing such candles after a crash is harmless and idempotent).
  let uncommittedCursor: string | null = null;

  for (const index of indices) {
    const candle = candles.M15[index] as Candle;
    const { input, tMs } = buildInputAt({ pair, candles, m15Index: index, settings, openSetups });
    const events = strategy.evaluate(input);
    report.candles++;
    if (events.length === 0) {
      uncommittedCursor = candle.time;
      continue;
    }

    const keys = [...new Set(events.map((e) => e.dedupeKey))];
    const existing = await store.loadAlertStates(strategy.id, keys);
    const changes = planAlertChanges({
      pair,
      existing,
      events,
      stepTime: new Date(tMs).toISOString(),
    });
    // This candle's alert changes and the cursor, in one transaction.
    await store.commitStep({ pair, strategyId: strategy.id, changes, cursorTime: candle.time });
    uncommittedCursor = null;
    openSetups = applyEvents(openSetups, events);

    report.changes += changes.length;
    for (const event of events) report.events[event.type]++;
  }
  if (uncommittedCursor !== null) {
    await store.commitStep({ pair, strategyId: strategy.id, changes: [], cursorTime: uncommittedCursor });
  }
  return report;
}

/** Candles + every active strategy for one pair. Strategy failures are isolated. */
async function scanPair(
  deps: CycleDeps & { logger: Logger },
  pair: Pair,
  config: CycleConfig,
): Promise<PairReport> {
  const started = Date.now();
  const savedCandles = await syncCandles(deps, pair);
  const candles = await loadPairCandles(deps.store, pair);
  const report: PairReport = { pair, ok: true, savedCandles, strategies: [] };

  for (const { strategy } of config.strategies) {
    const t0 = Date.now();
    try {
      const run = await scanPairStrategy({
        store: deps.store,
        pair,
        strategy,
        settings: config.settings,
        candles,
        logger: deps.logger,
      });
      report.strategies.push(run);
      deps.logger({
        component: "cycle",
        pair,
        strategy: strategy.id,
        candles: run.candles,
        events: Object.values(run.events).reduce((a, b) => a + b, 0),
        sweeps: run.events.SWEEP,
        confirms: run.events.CONFIRM,
        changes: run.changes,
        ms: Date.now() - t0,
        outcome: "ok",
      });
    } catch (error) {
      report.ok = false;
      report.strategies.push({
        strategyId: strategy.id,
        ok: false,
        candles: 0,
        skippedOld: 0,
        events: emptyEvents(),
        changes: 0,
      });
      deps.logger({
        component: "cycle",
        pair,
        strategy: strategy.id,
        ms: Date.now() - t0,
        outcome: "error",
        error: errorMessage(error),
      });
    }
  }
  deps.logger({
    component: "cycle",
    pair,
    newCandles: `D ${savedCandles.D} · H4 ${savedCandles.H4} · M15 ${savedCandles.M15}`,
    ms: Date.now() - started,
    outcome: report.ok ? "ok" : "partial",
  });
  return report;
}

// --- Step 6: cleanup -------------------------------------------------------

/** Deletes old candles on the first cycle after 00:00 UTC. Returns rows deleted, or null if not due. */
export async function cleanupIfDue(store: WorkerStore, now: Date): Promise<number | null> {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const last = await store.lastCleanupAt();
  if (last !== null && last >= todayStart.toISOString()) return null;
  const cutoffs = Object.fromEntries(
    TIMEFRAMES.map((tf) => [tf, new Date(now.getTime() - RETENTION_MS[tf]).toISOString()]),
  ) as Record<Timeframe, string>;
  return store.deleteCandlesBefore(cutoffs, now.toISOString());
}

// --- The cycle -------------------------------------------------------------

export async function runCycle(input: CycleDeps): Promise<CycleReport> {
  const deps = { ...input, logger: input.logger ?? silentLogger };
  const getStrategy = deps.getStrategy ?? registryGetStrategy;
  const started = Date.now();
  const startedAt = deps.now.toISOString();
  const pairs: PairReport[] = [];

  let config: CycleConfig;
  try {
    config = await readConfig(deps.store, getStrategy);
  } catch (error) {
    const message = `config load failed: ${errorMessage(error)}`;
    deps.logger({ component: "cycle", outcome: "error", error: message });
    await deps.store
      .writeHeartbeat({ lastScanAt: startedAt, status: "error", message, version: deps.version })
      .catch(() => {});
    return { startedAt, status: "error", message, pairs, ms: Date.now() - started };
  }
  for (const problem of config.problems) {
    deps.logger({ component: "cycle", outcome: "warning", message: problem });
  }

  for (const pair of config.pairs) {
    try {
      pairs.push(await scanPair(deps, pair, config));
    } catch (error) {
      pairs.push({ pair, ok: false, savedCandles: { D: 0, H4: 0, M15: 0 }, strategies: [], error: errorMessage(error) });
      deps.logger({ component: "cycle", pair, outcome: "error", error: errorMessage(error) });
    }
  }

  const failed = pairs.filter((p) => !p.ok).map((p) => p.pair);
  const allOk = failed.length === 0 && config.problems.length === 0;
  const status: HeartbeatStatus =
    pairs.length > 0 && failed.length === pairs.length ? "error" : allOk ? "ok" : "degraded";
  const processed = pairs.reduce(
    (sum, p) => sum + p.strategies.reduce((s, r) => s + r.candles, 0),
    0,
  );
  const message = [
    `${pairs.length - failed.length}/${pairs.length} pairs ok`,
    `${config.strategies.length} strategies`,
    `${processed} candle steps`,
    ...(failed.length > 0 ? [`failed: ${failed.join(", ")}`] : []),
    ...config.problems,
  ].join(" · ");

  try {
    await deps.store.writeHeartbeat({
      lastScanAt: startedAt,
      ...(allOk && { lastOkAt: startedAt }),
      status,
      message,
      version: deps.version,
    });
  } catch (error) {
    deps.logger({ component: "cycle", step: "heartbeat", outcome: "error", error: errorMessage(error) });
  }

  let cleanedCandles: number | undefined;
  try {
    const deleted = await cleanupIfDue(deps.store, deps.now);
    if (deleted !== null) {
      cleanedCandles = deleted;
      deps.logger({ component: "cycle", step: "cleanup", outcome: "ok", deleted });
    }
  } catch (error) {
    deps.logger({ component: "cycle", step: "cleanup", outcome: "error", error: errorMessage(error) });
  }

  const ms = Date.now() - started;
  deps.logger({ component: "cycle", outcome: status, message, ms });
  return { startedAt, status, message, pairs, cleanedCandles, ms };
}
