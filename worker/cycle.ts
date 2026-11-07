// One scan cycle: read config → sync candles per pair → run every LIVE and
// TEST strategy over the new closed M15 candles, one at a time, oldest
// first (same input as the backtester) → resolve open paper trades with
// lib/paper (same resolver as the backtester) → heartbeat → daily cleanup.
// Notifications (Unit 10) plug in later.
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { hoursToCandles, TIMEFRAME_MS } from "@/lib/market/time";
import { resolvePaperTrade } from "@/lib/paper/resolve";
import { applyEvents, planAlertChanges } from "@/lib/strategy/apply-events";
import { activeStrategies, type StrategyModeRow } from "@/lib/strategy/modes";
import { getStrategy as registryGetStrategy } from "@/lib/strategy/registry";
import { buildInputAt, STRATEGY_WINDOWS } from "@/lib/strategy/replay";
import type { SetupEvent, Strategy, StrategySettings } from "@/lib/strategy/types";
import { describeError, silentLogger, type Logger } from "./log";
import { OandaAuthError } from "./oanda/client";
import type { PriceSource } from "./prices";
import type { ClosedPaperResult, HeartbeatStatus, WorkerStore } from "./store";

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

export interface PaperRunReport {
  /** OPEN paper trades checked this cycle. */
  open: number;
  /** Of those, decided this cycle (WIN / LOSS / UNRESOLVED). */
  resolved: number;
  failed: number;
}

export interface PairReport {
  pair: Pair;
  ok: boolean;
  /** Pair is switched off; only kept for its open paper trades (M15 only). */
  paperOnly?: boolean;
  savedCandles: Record<Timeframe, number>;
  strategies: StrategyRunReport[];
  paper: PaperRunReport;
  error?: string;
  /** OANDA rejected the token for this pair (401 after every retry, or 403). */
  authFailed?: boolean;
}

/** Heartbeat message when OANDA keeps rejecting the token. */
export const TOKEN_REJECTED_MESSAGE = "OANDA rejected the token";

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
  /** paperTimeoutHours × 4. */
  paperTimeoutCandles: number;
  pairs: Pair[];
  /** Switched-off pairs that still have OPEN paper trades. */
  paperOnlyPairs: Pair[];
  strategies: Array<{ mode: StrategyModeRow["mode"]; strategy: Strategy }>;
  problems: string[];
}

export async function readConfig(
  store: WorkerStore,
  getStrategy: (id: string) => Strategy,
): Promise<CycleConfig> {
  const [settings, pairs, modes, paperPairs] = await Promise.all([
    store.loadSettings(),
    store.loadEnabledPairs(),
    store.loadStrategyModes(),
    store.pairsWithOpenPaperTrades(),
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
  return {
    settings: settings.strategy,
    paperTimeoutCandles: hoursToCandles(settings.paperTimeoutHours, "M15"),
    pairs,
    paperOnlyPairs: paperPairs.filter((p) => !pairs.includes(p)),
    strategies,
    problems,
  };
}

// --- Step 2: candles -------------------------------------------------------

/** Fetches everything since the newest stored candle (or backfills) and saves it. */
export async function syncCandles(
  deps: Pick<CycleDeps, "store" | "prices" | "now">,
  pair: Pair,
  timeframes: readonly Timeframe[] = TIMEFRAMES,
): Promise<Record<Timeframe, number>> {
  const saved: Record<Timeframe, number> = { D: 0, H4: 0, M15: 0 };
  for (const timeframe of timeframes) {
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

// --- Step 4: paper trades --------------------------------------------------

/**
 * Resolves every OPEN paper trade on this pair, from every strategy (OFF
 * included). Each trade gets all stored M15 candles that open at or after
 * its paperOpenedAt (the candles after the entry candle), oldest first, up
 * to the time limit — the same call the backtester makes, so re-feeding the
 * whole window each cycle is safe and catch-up after downtime is automatic.
 * Trades are isolated: one failure doesn't stop the others.
 */
export async function resolvePaperTrades(args: {
  store: WorkerStore;
  pair: Pair;
  timeoutCandles: number;
  logger: Logger;
}): Promise<PaperRunReport> {
  const { store, pair, timeoutCandles, logger } = args;
  const trades = await store.loadOpenPaperTrades(pair);
  const report: PaperRunReport = { open: trades.length, resolved: 0, failed: 0 };
  for (const trade of trades) {
    try {
      const candles = await store.loadCandlesFrom(pair, "M15", trade.openedAt, timeoutCandles);
      const result = resolvePaperTrade(trade, candles, timeoutCandles);
      if (result.status === "OPEN") continue;
      const closed: ClosedPaperResult = {
        status: result.status,
        exitPrice: result.exitPrice as number,
        closedAt: result.closedAt as string,
        resultR: result.resultR as number,
        pnlUsd: result.pnlUsd as number,
        ...(result.note !== undefined && { note: result.note }),
      };
      if (!(await store.closePaperTrade(trade.alertId, closed))) continue; // already decided
      report.resolved++;
      logger({
        component: "paper",
        pair,
        strategy: trade.strategyId,
        alertId: trade.alertId,
        status: closed.status,
        R: closed.resultR,
        usd: closed.pnlUsd,
        ...(closed.note && { note: closed.note }),
        outcome: "resolved",
      });
    } catch (error) {
      report.failed++;
      logger({
        component: "paper",
        pair,
        strategy: trade.strategyId,
        alertId: trade.alertId,
        outcome: "error",
        error: errorMessage(error),
      });
    }
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
  const report: PairReport = {
    pair,
    ok: true,
    savedCandles,
    strategies: [],
    paper: { open: 0, resolved: 0, failed: 0 },
  };

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
  // After the strategy steps, so a trade opened this cycle is checked too.
  report.paper = await resolvePaperTrades({
    store: deps.store,
    pair,
    timeoutCandles: config.paperTimeoutCandles,
    logger: deps.logger,
  });
  if (report.paper.failed > 0) report.ok = false;

  deps.logger({
    component: "cycle",
    pair,
    newCandles: `D ${savedCandles.D} · H4 ${savedCandles.H4} · M15 ${savedCandles.M15}`,
    paperOpen: report.paper.open,
    paperResolved: report.paper.resolved,
    ms: Date.now() - started,
    outcome: report.ok ? "ok" : "partial",
  });
  return report;
}

/**
 * A switched-off pair with OPEN paper trades: keep its M15 candles coming
 * until those trades close. No strategy runs on it.
 */
async function resolvePaperOnlyPair(
  deps: CycleDeps & { logger: Logger },
  pair: Pair,
  config: CycleConfig,
): Promise<PairReport> {
  const started = Date.now();
  const savedCandles = await syncCandles(deps, pair, ["M15"]);
  const paper = await resolvePaperTrades({
    store: deps.store,
    pair,
    timeoutCandles: config.paperTimeoutCandles,
    logger: deps.logger,
  });
  const ok = paper.failed === 0;
  deps.logger({
    component: "cycle",
    pair,
    paperOnly: true,
    newCandles: `M15 ${savedCandles.M15}`,
    paperOpen: paper.open,
    paperResolved: paper.resolved,
    ms: Date.now() - started,
    outcome: ok ? "ok" : "partial",
  });
  return { pair, ok, paperOnly: true, savedCandles, strategies: [], paper };
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

  const work = [
    ...config.pairs.map((pair) => ({ pair, run: () => scanPair(deps, pair, config) })),
    ...config.paperOnlyPairs.map((pair) => ({ pair, run: () => resolvePaperOnlyPair(deps, pair, config) })),
  ];
  for (const { pair, run } of work) {
    try {
      pairs.push(await run());
    } catch (error) {
      // e.g. OANDA down or the token rejected: this pair fails for this cycle only.
      pairs.push({
        pair,
        ok: false,
        ...(config.paperOnlyPairs.includes(pair) && { paperOnly: true }),
        savedCandles: { D: 0, H4: 0, M15: 0 },
        strategies: [],
        paper: { open: 0, resolved: 0, failed: 0 },
        error: errorMessage(error),
        ...(error instanceof OandaAuthError && { authFailed: true }),
      });
      deps.logger({ component: "cycle", pair, outcome: "error", error: errorMessage(error) });
    }
  }

  const failed = pairs.filter((p) => !p.ok).map((p) => p.pair);
  const tokenRejected = pairs.some((p) => p.authFailed);
  const allOk = failed.length === 0 && config.problems.length === 0;
  // A rejected token is "degraded" (decision after Unit 7), even if every
  // pair failed; other total failures are "error".
  const status: HeartbeatStatus = allOk
    ? "ok"
    : pairs.length > 0 && failed.length === pairs.length && !tokenRejected
      ? "error"
      : "degraded";
  const processed = pairs.reduce(
    (sum, p) => sum + p.strategies.reduce((s, r) => s + r.candles, 0),
    0,
  );
  const paperOpen = pairs.reduce((sum, p) => sum + p.paper.open - p.paper.resolved, 0);
  const paperResolved = pairs.reduce((sum, p) => sum + p.paper.resolved, 0);
  const message = [
    ...(tokenRejected ? [TOKEN_REJECTED_MESSAGE] : []),
    `${pairs.length - failed.length}/${pairs.length} pairs ok`,
    `${config.strategies.length} strategies`,
    `${processed} candle steps`,
    `paper ${paperResolved} resolved, ${paperOpen} open`,
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
