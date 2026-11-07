// Paper trades inside the worker cycle (Unit 8), with the in-memory store.
import { describe, expect, it } from "vitest";
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { NOTE_GAPPED_STOP, NOTE_SAME_CANDLE, NOTE_TIMEOUT } from "@/lib/paper/resolve";
import { SETTINGS } from "@/lib/strategy/__fixtures__/candles";
import type { SetupEvent, Strategy, StrategyInput } from "@/lib/strategy/types";
import { runCycle, TOKEN_REJECTED_MESSAGE } from "./cycle";
import { OandaAuthError } from "./oanda/client";
import { memoryPriceSource, type PriceSource } from "./prices";
import { MemoryStore, type MemoryAlert } from "./store";

const M15 = 15 * 60_000;
// Wed 4 Nov 2026: market open all day.
const START = Date.parse("2026-11-04T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

// SELL from 1.1000: stop 1.1020 (20 pips), target 1.0940 (1:3), $50 risk.
const ENTRY = 1.1;
const STOP = 1.102;
const TARGET = 1.094;

type Bar = Partial<Pick<Candle, "open" | "high" | "low" | "close">>;
/** M15 candles from START; each bar overrides the quiet default. */
function candles(bars: Bar[], startMs = START): Candle[] {
  return bars.map((bar, i) => ({
    time: iso(startMs + i * M15),
    open: 1.1,
    high: 1.1005,
    low: 1.0995,
    close: 1.1,
    ...bar,
  }));
}
const quiet = (n: number): Bar[] => Array.from({ length: n }, () => ({}));
const closeOf = (c: Candle) => new Date(Date.parse(c.time) + M15 + 10_000);
const tf = (m15: Candle[]): Record<Timeframe, Candle[]> => ({ D: [], H4: [], M15: m15 });

/** A strategy that never emits anything (paper resolution is independent of it). */
const silent: Strategy = { id: "rec", name: "rec", description: "test", evaluate: () => [] };

function store(args: { pairs?: Pair[]; modes?: Array<{ strategyId: string; mode: "LIVE" | "TEST" | "OFF" }>; timeoutHours?: number } = {}) {
  return new MemoryStore({
    settings: SETTINGS,
    paperTimeoutHours: args.timeoutHours,
    enabledPairs: args.pairs ?? ["EUR_USD"],
    strategyModes: args.modes ?? [{ strategyId: "rec", mode: "LIVE" }],
  });
}

/** A READY alert whose paper trade opened at the close of `entryCandle`. */
function openTrade(s: MemoryStore, entryCandle: Candle, extra: Partial<MemoryAlert> = {}): MemoryAlert {
  const openedAt = iso(Date.parse(entryCandle.time) + M15);
  return s.putAlert({
    strategyId: "rec",
    dedupeKey: `EUR_USD:SELL:${entryCandle.time}`,
    pair: "EUR_USD",
    direction: "SELL",
    status: "READY",
    sweepType: "PDH",
    sweepLevel: 1.1015,
    sweepExtreme: 1.1017,
    sweepTime: entryCandle.time,
    bosLevel: 1.1,
    expiresAt: openedAt,
    entry: ENTRY,
    stop: STOP,
    target: TARGET,
    stopPips: 20,
    targetPips: 60,
    lotSize: 0.25,
    riskPct: 0.5,
    riskUsd: 50,
    readyAt: openedAt,
    paperStatus: "OPEN",
    paperOpenedAt: openedAt,
    ...extra,
  });
}

async function cycle(s: MemoryStore, prices: PriceSource, now: Date, strategy: Strategy = silent) {
  const logs: Record<string, unknown>[] = [];
  const report = await runCycle({ store: s, prices, now, getStrategy: () => strategy, logger: (l) => logs.push(l) });
  return { report, logs };
}

describe("paper trades in the worker cycle", () => {
  it("a Ready alert opened by the strategy resolves to a Win when a later candle reaches the target", async () => {
    // Candle 2 sweeps, candle 3 confirms (entry at its close), candle 6 hits the target.
    const bars = quiet(8);
    bars[6] = { high: 1.1004, low: 1.0935, close: 1.0938 };
    const m15 = candles(bars);
    const sweepTime = m15[2]?.time as string;
    const confirmTime = m15[3]?.time as string;
    const key = `EUR_USD:SELL:${sweepTime}`;
    const strategy: Strategy = {
      id: "rec",
      name: "rec",
      description: "sweep then confirm",
      evaluate(input: StrategyInput): SetupEvent[] {
        const t = input.candles.M15.at(-1)?.time;
        if (t === sweepTime) {
          return [
            {
              type: "SWEEP",
              pair: "EUR_USD",
              dedupeKey: key,
              direction: "SELL",
              sweepType: "PDH",
              sweepLevel: 1.1015,
              sweepExtreme: 1.1017,
              sweepTime,
              bosLevel: 1.1,
              expiresAt: iso(START + 10 * M15),
            },
          ];
        }
        if (t === confirmTime) {
          return [
            {
              type: "CONFIRM",
              dedupeKey: key,
              confirmTime,
              ticket: { entry: ENTRY, stop: STOP, target: TARGET, stopPips: 20, targetPips: 60, riskPct: 0.5, riskUsd: 50, lotSize: 0.25 },
            },
          ];
        }
        return [];
      },
    };
    const s = store();
    s.cursors.set("EUR_USD|rec", m15[1]?.time as string);
    const prices = memoryPriceSource({ EUR_USD: tf(m15) });

    // After candle 4: READY with an OPEN paper trade, not decided yet.
    await cycle(s, prices, closeOf(m15[4] as Candle), strategy);
    let [alert] = s.listAlerts();
    expect(alert).toMatchObject({ status: "READY", paperStatus: "OPEN", paperOpenedAt: iso(START + 4 * M15) });

    // After candle 7: the target candle (6) decided it.
    const { logs } = await cycle(s, prices, closeOf(m15[7] as Candle), strategy);
    [alert] = s.listAlerts();
    expect(alert).toMatchObject({
      paperStatus: "WIN",
      paperExitPrice: TARGET,
      paperResultR: 3,
      paperPnlUsd: 150,
      paperClosedAt: iso(START + 7 * M15),
    });
    expect(logs).toContainEqual(
      expect.objectContaining({ component: "paper", pair: "EUR_USD", strategy: "rec", alertId: alert?.id, status: "WIN", R: 3, usd: 150 }),
    );
  });

  it("stop and target in the same candle is a Loss with a note", async () => {
    const bars = quiet(4);
    bars[2] = { high: 1.1025, low: 1.093 };
    const m15 = candles(bars);
    const s = store();
    const alert = openTrade(s, m15[0] as Candle);
    await cycle(s, memoryPriceSource({ EUR_USD: tf(m15) }), closeOf(m15[3] as Candle));
    expect(alert).toMatchObject({ paperStatus: "LOSS", paperResultR: -1, paperPnlUsd: -50, paperNote: NOTE_SAME_CANDLE });
  });

  it("a gap through the stop exits at the candle's open", async () => {
    const bars = quiet(3);
    bars[1] = { open: 1.103, high: 1.1035, low: 1.1028, close: 1.1031 };
    const m15 = candles(bars);
    const s = store();
    const alert = openTrade(s, m15[0] as Candle);
    await cycle(s, memoryPriceSource({ EUR_USD: tf(m15) }), closeOf(m15[2] as Candle));
    expect(alert).toMatchObject({ paperStatus: "LOSS", paperExitPrice: 1.103, paperResultR: -1.5, paperNote: NOTE_GAPPED_STOP });
  });

  it("times out to Unresolved at the last close after paperTimeoutHours × 4 candles", async () => {
    const bars = quiet(10);
    bars[4] = { close: 1.0985 }; // 4th candle after entry = the 1-hour limit
    const m15 = candles(bars);
    const s = store({ timeoutHours: 1 });
    const alert = openTrade(s, m15[0] as Candle);
    const prices = memoryPriceSource({ EUR_USD: tf(m15) });

    await cycle(s, prices, closeOf(m15[3] as Candle)); // only 3 candles after entry
    expect(alert.paperStatus).toBe("OPEN");
    await cycle(s, prices, closeOf(m15[9] as Candle));
    expect(alert).toMatchObject({
      paperStatus: "UNRESOLVED",
      paperExitPrice: 1.0985,
      paperResultR: 0.75,
      paperClosedAt: iso(START + 5 * M15),
      paperNote: NOTE_TIMEOUT,
    });
  });

  it("catches up correctly after a 3-hour outage", async () => {
    // Entry after candle 0; the target is hit at candle 9, during the outage.
    const bars = quiet(16);
    bars[9] = { low: 1.0939 };
    bars[12] = { high: 1.1025 }; // a later stop touch must not matter
    const m15 = candles(bars);
    const s = store();
    const alert = openTrade(s, m15[0] as Candle);
    const prices = memoryPriceSource({ EUR_USD: tf(m15) });

    await cycle(s, prices, closeOf(m15[2] as Candle));
    expect(alert.paperStatus).toBe("OPEN");
    // Worker down from candle 3 to candle 14 (3 hours), back after 15 closes.
    const { report } = await cycle(s, prices, closeOf(m15[15] as Candle));
    expect(report.status).toBe("ok");
    expect(alert).toMatchObject({ paperStatus: "WIN", paperResultR: 3, paperClosedAt: iso(START + 10 * M15) });
  });

  it("an OFF strategy's open trade still resolves", async () => {
    const bars = quiet(3);
    bars[1] = { low: 1.0939 };
    const m15 = candles(bars);
    const s = store({ modes: [{ strategyId: "rec", mode: "LIVE" }, { strategyId: "old", mode: "OFF" }] });
    const alert = openTrade(s, m15[0] as Candle, { strategyId: "old" });
    const { logs } = await cycle(s, memoryPriceSource({ EUR_USD: tf(m15) }), closeOf(m15[2] as Candle));
    expect(alert.paperStatus).toBe("WIN");
    expect(logs).toContainEqual(expect.objectContaining({ component: "paper", strategy: "old", status: "WIN" }));
  });

  it("a disabled pair keeps its M15 candles coming until its trades close; no strategy runs on it", async () => {
    const bars = quiet(6);
    bars[4] = { high: 1.1021 };
    const m15 = candles(bars);
    const evaluated: string[] = [];
    const watcher: Strategy = { ...silent, evaluate: (input) => (evaluated.push(input.pair), []) };
    const s = store({ pairs: ["GBP_USD"] }); // EUR_USD switched off
    const alert = openTrade(s, m15[0] as Candle);
    const prices = memoryPriceSource({
      EUR_USD: { D: candles(quiet(3)), H4: candles(quiet(3)), M15: m15 },
      GBP_USD: tf(candles(quiet(6))),
    });

    const first = await cycle(s, prices, closeOf(m15[2] as Candle), watcher);
    expect(alert.paperStatus).toBe("OPEN");
    expect(first.report.pairs.find((p) => p.pair === "EUR_USD")).toMatchObject({ ok: true, paperOnly: true });
    expect(s.candles.get("EUR_USD|M15")).toHaveLength(3);
    expect(s.candles.get("EUR_USD|D")).toBeUndefined(); // M15 only

    await cycle(s, prices, closeOf(m15[5] as Candle), watcher);
    expect(alert).toMatchObject({ paperStatus: "LOSS", paperResultR: -1 });
    expect(evaluated.every((p) => p === "GBP_USD")).toBe(true);

    // Trade closed: the pair is no longer fetched.
    const third = await cycle(s, prices, closeOf(m15[5] as Candle), watcher);
    expect(third.report.pairs.map((p) => p.pair)).toEqual(["GBP_USD"]);
  });

  it("a closed trade is never reopened or changed", async () => {
    const bars = quiet(6);
    bars[1] = { low: 1.0939 }; // WIN at candle 1
    const m15 = candles(bars);
    const s = store();
    const alert = openTrade(s, m15[0] as Candle);
    const prices = memoryPriceSource({ EUR_USD: tf(m15) });
    await cycle(s, prices, closeOf(m15[2] as Candle));
    const decided = { ...alert };
    expect(decided.paperStatus).toBe("WIN");

    // Even if a later run computed something else, a decided trade stays as it is.
    const saved = await s.closePaperTrade(alert.id, {
      status: "LOSS",
      exitPrice: STOP,
      closedAt: iso(START + 5 * M15),
      resultR: -1,
      pnlUsd: -50,
    });
    expect(saved).toBe(false);
    await cycle(s, prices, closeOf(m15[5] as Candle));
    expect(alert).toEqual(decided);
    expect(s.paperCloses).toBe(1);
    expect(await s.loadOpenPaperTrades("EUR_USD")).toEqual([]);
  });

  it("re-running a cycle over the same candles saves each result once", async () => {
    const bars = quiet(4);
    bars[2] = { low: 1.0939 };
    const m15 = candles(bars);
    const s = store();
    openTrade(s, m15[0] as Candle);
    const prices = memoryPriceSource({ EUR_USD: tf(m15) });
    const now = closeOf(m15[3] as Candle);
    await cycle(s, prices, now);
    const { logs } = await cycle(s, prices, now);
    expect(s.paperCloses).toBe(1);
    expect(logs.filter((l) => l.component === "paper")).toEqual([]);
  });

  it("a rejected OANDA token fails the pair and marks the heartbeat degraded", async () => {
    const s = store();
    const prices: PriceSource = {
      fetchClosedSince: async () => {
        throw new OandaAuthError(401, 4);
      },
    };
    const { report } = await cycle(s, prices, new Date(START + 4 * M15));
    expect(report.pairs[0]).toMatchObject({ ok: false, authFailed: true });
    expect(report.status).toBe("degraded");
    expect(s.heartbeat?.message).toContain(TOKEN_REJECTED_MESSAGE);
  });
});
