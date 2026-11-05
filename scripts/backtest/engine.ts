// Pure backtest engine: replays closed M15 candles one at a time through a
// strategy and the paper-trade resolver. No I/O.
import type { Candle, Direction, Pair, Timeframe, TradeTicket } from "@/lib/types";
import { TIMEFRAME_MS } from "@/lib/market/time";
import {
  PAPER_TIMEOUT_CANDLES,
  resolvePaperTrade,
  type PaperResult,
  type PaperTrade,
} from "@/lib/paper/resolve";
import { applyEvents } from "@/lib/strategy/apply-events";
import type {
  OpenSetup,
  Strategy,
  StrategyInput,
  StrategySettings,
  SweepType,
} from "@/lib/strategy/types";

/**
 * Rolling windows passed to the strategy each step (for speed). 500 M15
 * candles is about 2.5 forex days — more than dg-v1 reads (equal highs/lows
 * look back two forex days; the BOS level is the latest swing). On the
 * Jan–Nov 2026 data, 500 gives byte-identical results to 2000, ~3× faster.
 */
export const DEFAULT_WINDOWS: Record<Timeframe, number> = { D: 150, H4: 300, M15: 500 };

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

function closeMs(candle: Candle, timeframe: Timeframe): number {
  return Date.parse(candle.time) + TIMEFRAME_MS[timeframe];
}

/**
 * Throws if any candle passed to the strategy had not closed by `tMs`.
 * Checks every candle, comparing canonical ISO strings (see Candle.time):
 * a candle has closed by t if it opened at or before t − its duration.
 */
export function assertNoLookAhead(input: StrategyInput, tMs: number): void {
  for (const timeframe of ["D", "H4", "M15"] as const) {
    const latestAllowedOpen = new Date(tMs - TIMEFRAME_MS[timeframe]).toISOString();
    for (const candle of input.candles[timeframe]) {
      if (candle.time > latestAllowedOpen) {
        throw new Error(
          `Look-ahead: ${timeframe} candle ${candle.time} closes after ${new Date(tMs).toISOString()}`,
        );
      }
    }
  }
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
  let dEnd = 0;
  let h4End = 0;
  let steps = 0;

  for (let i = 0; i < M15.length; i++) {
    const candle = M15[i];
    if (!candle) continue;
    const t = closeMs(candle, "M15");
    if (t > input.toMs) break;

    // Higher-timeframe candles that have closed by t.
    while (dEnd < D.length && closeMs(D[dEnd] as Candle, "D") <= t) dEnd++;
    while (h4End < H4.length && closeMs(H4[h4End] as Candle, "H4") <= t) h4End++;
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

    // 2. Evaluate the strategy with only closed candles.
    const strategyInput: StrategyInput = {
      pair,
      now: new Date(t),
      candles: {
        D: D.slice(Math.max(0, dEnd - windows.D), dEnd),
        H4: H4.slice(Math.max(0, h4End - windows.H4), h4End),
        M15: M15.slice(Math.max(0, i + 1 - windows.M15), i + 1),
      },
      settings,
      openSetups,
    };
    assertNoLookAhead(strategyInput, t);
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
  }

  return { setups: [...setups.values()], trades, steps };
}
