// Pure backtest engine: replays closed M15 candles one at a time through a
// strategy and the paper-trade resolver. No I/O.
import type { Candle, Direction, Pair, Timeframe, TradeTicket } from "@/lib/types";
import {
  PAPER_TIMEOUT_CANDLES,
  resolvePaperTrade,
  timeExitAt,
  type PaperResult,
  type PaperTrade,
} from "@/lib/paper/resolve";
import { applyEvents, applyEventsToRecent } from "@/lib/strategy/apply-events";
import { buildInputAt, candleCloseMs, STRATEGY_WINDOWS } from "@/lib/strategy/replay";
import type { OpenSetup, RecentAlert, Strategy, StrategySettings, SweepType } from "@/lib/strategy/types";

export { assertNoLookAhead } from "@/lib/strategy/replay";

/** Same windows as the live worker (lib/strategy/replay.ts). */
export const DEFAULT_WINDOWS: Record<Timeframe, number> = STRATEGY_WINDOWS;

export type SetupStatus = "WATCHING" | "CONFIRMED" | "EXPIRED" | "INVALID";

export interface SetupRecord {
  dedupeKey: string;
  pair: Pair;
  direction: Direction;
  sweepType: SweepType;
  sweepLevel: number;
  /** Open time of the sweep candle (ISO, UTC). */
  sweepTime: string;
  /** Final extreme (after any EXTEND). */
  sweepExtreme: number;
  bosLevel: number;
  /** ISO, UTC: end of the watch window (from the SWEEP event). */
  expiresAt: string;
  status: SetupStatus;
  /** Open time of the confirming candle (ISO, UTC). */
  confirmTime?: string;
  reason?: string;
}

export interface TradeRecord {
  setup: SetupRecord;
  ticket: TradeTicket;
  trade: PaperTrade;
  result: PaperResult;
}

export interface BacktestInput {
  strategy: Strategy;
  pair: Pair;
  candles: { D: readonly Candle[]; H4: readonly Candle[]; M15: readonly Candle[] };
  settings: StrategySettings;
  /** Evaluate M15 candles whose open time is ≥ from (earlier ones are history only). */
  fromMs: number;
  /** Stop after the last M15 candle that closes by `toMs`. */
  toMs: number;
  windows?: Record<Timeframe, number>;
  timeoutCandles?: number;
}

export interface BacktestOutput {
  setups: SetupRecord[];
  trades: TradeRecord[];
  /** Number of M15 candles evaluated. */
  steps: number;
}

/**
 * Replays time forward one closed M15 candle at a time. At step `t` (the
 * close of M15[i]) the strategy sees only D, H4 and M15 candles that closed
 * by `t`. Events are applied like the worker will: SWEEP opens a setup,
 * EXTEND updates it, EXPIRE / SKIP_INVALID close it, CONFIRM closes it and
 * opens a paper trade from the next candle. One trade per setup; fixed
 * account size (no compounding).
 */
export function runBacktest(input: BacktestInput): BacktestOutput {
  const { strategy, pair, settings, candles } = input;
  const windows = input.windows ?? DEFAULT_WINDOWS;
  const timeout = input.timeoutCandles ?? PAPER_TIMEOUT_CANDLES;
  const { D, H4, M15 } = candles;

  const setups = new Map<string, SetupRecord>();
  const trades: TradeRecord[] = [];
  const openTrades: Array<{ record: TradeRecord; entryIndex: number }> = [];
  let openSetups: OpenSetup[] = [];
  // The strategy's alerts so far (same updates as the worker's database).
  let recentAlerts: RecentAlert[] = [];
  let steps = 0;

  for (let i = 0; i < M15.length; i++) {
    const candle = M15[i];
    if (!candle) continue;
    const t = candleCloseMs(candle, "M15");
    if (t > input.toMs) break;
    if (Date.parse(candle.time) < input.fromMs) continue;
    steps++;

    // 1. Feed this candle to paper trades opened on earlier candles.
    for (let k = openTrades.length - 1; k >= 0; k--) {
      const open = openTrades[k];
      if (!open) continue;
      const result = resolvePaperTrade(open.record.trade, M15.slice(open.entryIndex + 1, i + 1), timeout);
      if (result.status !== "OPEN") {
        open.record.result = result;
        openTrades.splice(k, 1);
      }
    }

    // 2. Evaluate the strategy with only candles closed by t (shared with the worker).
    const { input: strategyInput } = buildInputAt({
      pair,
      candles: { D, H4, M15 },
      m15Index: i,
      settings,
      openSetups,
      recentAlerts,
      windows,
    });
    const events = strategy.evaluate(strategyInput);

    // 3. Apply events.
    for (const event of events) {
      switch (event.type) {
        case "SWEEP":
          setups.set(event.dedupeKey, {
            dedupeKey: event.dedupeKey,
            pair,
            direction: event.direction,
            sweepType: event.sweepType,
            sweepLevel: event.sweepLevel,
            sweepTime: event.sweepTime,
            sweepExtreme: event.sweepExtreme,
            bosLevel: event.bosLevel,
            expiresAt: event.expiresAt,
            status: "WATCHING",
          });
          break;
        case "EXTEND": {
          const setup = setups.get(event.dedupeKey);
          if (setup) setup.sweepExtreme = event.sweepExtreme;
          break;
        }
        case "EXPIRE": {
          const setup = setups.get(event.dedupeKey);
          if (setup) setup.status = "EXPIRED";
          break;
        }
        case "SKIP_INVALID": {
          const setup = setups.get(event.dedupeKey);
          if (setup) Object.assign(setup, { status: "INVALID", reason: event.reason });
          break;
        }
        case "CONFIRM": {
          const setup = setups.get(event.dedupeKey);
          if (!setup) break;
          setup.status = "CONFIRMED";
          setup.confirmTime = event.confirmTime;
          const record: TradeRecord = {
            setup,
            ticket: event.ticket,
            trade: {
              pair,
              direction: setup.direction,
              entry: event.ticket.entry,
              stop: event.ticket.stop,
              target: event.ticket.target,
              riskUsd: event.ticket.riskUsd,
              openedAt: new Date(t).toISOString(),
              ...(strategy.exitAtUtcHour !== undefined && {
                exitAt: timeExitAt(new Date(t).toISOString(), strategy.exitAtUtcHour),
              }),
              ...(event.entryType === "LIMIT" && {
                entryType: "LIMIT" as const,
                ...(event.entryValidUntil !== undefined && { entryValidUntil: event.entryValidUntil }),
              }),
            },
            result: { status: "OPEN" },
          };
          trades.push(record);
          openTrades.push({ record, entryIndex: i });
          break;
        }
      }
    }
    openSetups = applyEvents(openSetups, events);
    if (events.length > 0) {
      recentAlerts = applyEventsToRecent(recentAlerts, events);
      // Keep memory bounded; buildInputAt trims to the M15 window anyway.
      if (recentAlerts.length > 200) recentAlerts = recentAlerts.slice(-100);
    }
  }

  return { setups: [...setups.values()], trades, steps };
}
