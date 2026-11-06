import { describe, expect, it } from "vitest";
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { SETTINGS } from "@/lib/strategy/__fixtures__/candles";
import type { SetupEvent, Strategy, StrategyInput } from "@/lib/strategy/types";
import { cleanupIfDue, pendingCandleIndices, runCycle } from "./cycle";
import { memoryPriceSource, type PriceSource } from "./prices";
import { MemoryStore } from "./store";

const M15 = 15 * 60_000;
const H = 3_600_000;
// Wed 4 Nov 2026: market open all day.
const START = Date.parse("2026-11-04T00:00:00.000Z");

/** Flat M15 candles from START, `n` of them. */
function m15Candles(n: number, startMs = START): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: new Date(startMs + i * M15).toISOString(),
    open: 1.1,
    high: 1.101,
    low: 1.099,
    close: 1.1,
  }));
}
const closeOf = (c: Candle) => new Date(Date.parse(c.time) + M15);
const tf = (candles: Candle[]): Record<Timeframe, Candle[]> => ({ D: [], H4: [], M15: candles });

/** Strategy that records every candle it sees and emits a SWEEP on chosen candles. */
function recorder(id: string, sweepOn: string[] = []) {
  const seen: string[] = [];
  const strategy: Strategy = {
    id,
    name: id,
    description: "test",
    evaluate(input: StrategyInput): SetupEvent[] {
      const candle = input.candles.M15.at(-1);
      if (!candle) return [];
      seen.push(candle.time);
      if (!sweepOn.includes(candle.time)) return [];
      return [
        {
          type: "SWEEP",
          pair: input.pair,
          dedupeKey: `${input.pair}:SELL:${candle.time}`,
          direction: "SELL",
          sweepType: "PDH",
          sweepLevel: 1.1,
          sweepExtreme: candle.high,
          sweepTime: candle.time,
          bosLevel: 1.099,
          expiresAt: new Date(Date.parse(candle.time) + 3 * H).toISOString(),
        },
      ];
    },
  };
  return { strategy, seen };
}

function setup(args: {
  pairs?: Pair[];
  candles: Partial<Record<Pair, Record<Timeframe, Candle[]>>>;
  modes?: Array<{ strategyId: string; mode: "LIVE" | "TEST" | "OFF" }>;
  cursors?: Array<{ pair: Pair; strategyId: string; lastCandleTime: string }>;
}) {
  return new MemoryStore({
    settings: SETTINGS,
    enabledPairs: args.pairs ?? ["EUR_USD"],
    strategyModes: args.modes ?? [{ strategyId: "rec", mode: "LIVE" }],
    cursors: args.cursors,
  });
}

describe("runCycle", () => {
  it("stores candles, runs the strategy, writes alerts and an ok heartbeat", async () => {
    const candles = m15Candles(8);
    const last = candles.at(-1) as Candle;
    const { strategy } = recorder("rec", [last.time]);
    const store = setup({ candles: {} });
    const report = await runCycle({
      store,
      prices: memoryPriceSource({ EUR_USD: tf(candles) }),
      now: new Date(closeOf(last).getTime() + 10_000),
      getStrategy: () => strategy,
    });
    expect(report.status).toBe("ok");
    expect(store.candles.get("EUR_USD|M15")).toHaveLength(8);
    expect(store.listAlerts()).toHaveLength(1);
    expect(store.heartbeat).toMatchObject({ status: "ok", lastOkAt: report.startedAt });
    expect(await store.loadCursor("EUR_USD", "rec")).toBe(last.time);
  });

  it("first run (no cursor) processes only the latest closed candle", async () => {
    const candles = m15Candles(20);
    const { strategy, seen } = recorder("rec");
    const store = setup({ candles: {} });
    await runCycle({
      store,
      prices: memoryPriceSource({ EUR_USD: tf(candles) }),
      now: closeOf(candles.at(-1) as Candle),
      getStrategy: () => strategy,
    });
    expect(seen).toEqual([candles.at(-1)?.time]);
  });

  it("two runs over the same candles create no duplicates", async () => {
    const candles = m15Candles(12);
    const sweepTimes = [candles[5]?.time, candles[9]?.time].filter((t): t is string => !!t);
    const { strategy } = recorder("rec", sweepTimes);
    const prices = memoryPriceSource({ EUR_USD: tf(candles) });
    const cursor = { pair: "EUR_USD" as const, strategyId: "rec", lastCandleTime: candles[0]?.time ?? "" };
    const store = setup({ candles: {}, cursors: [cursor] });
    const now = closeOf(candles.at(-1) as Candle);

    await runCycle({ store, prices, now, getStrategy: () => strategy });
    await runCycle({ store, prices, now, getStrategy: () => strategy });
    expect(store.listAlerts()).toHaveLength(2);
    expect(store.candles.get("EUR_USD|M15")).toHaveLength(12);

    // Even replaying the same candles from an old cursor creates nothing new.
    store.cursors.set("EUR_USD|rec", cursor.lastCandleTime);
    await runCycle({ store, prices, now, getStrategy: () => strategy });
    expect(store.listAlerts()).toHaveLength(2);
  });

  it("catches up a 3-hour gap in order, one candle at a time", async () => {
    const candles = m15Candles(40);
    const cursorIndex = 27; // 12 candles (3 h) behind the latest
    const { strategy, seen } = recorder("rec");
    const store = setup({
      candles: {},
      cursors: [{ pair: "EUR_USD", strategyId: "rec", lastCandleTime: candles[cursorIndex]?.time ?? "" }],
    });
    await runCycle({
      store,
      prices: memoryPriceSource({ EUR_USD: tf(candles) }),
      now: closeOf(candles.at(-1) as Candle),
      getStrategy: () => strategy,
    });
    expect(seen).toEqual(candles.slice(cursorIndex + 1).map((c) => c.time));
    expect(seen).toHaveLength(12);
    // Quiet candles only move the cursor: one write at the end.
    expect(store.commits).toBe(1);
    expect(await store.loadCursor("EUR_USD", "rec")).toBe(candles.at(-1)?.time);
  });

  it("commits each candle that has events together with its cursor", async () => {
    const candles = m15Candles(20);
    const sweepOn = [candles[10]?.time, candles[14]?.time].filter((t): t is string => !!t);
    const { strategy } = recorder("rec", sweepOn);
    const store = setup({
      candles: {},
      cursors: [{ pair: "EUR_USD", strategyId: "rec", lastCandleTime: candles[7]?.time ?? "" }],
    });
    const cursorsAtCommit: string[] = [];
    const commit = store.commitStep.bind(store);
    store.commitStep = async (step) => {
      cursorsAtCommit.push(`${step.cursorTime}:${step.changes.length}`);
      return commit(step);
    };
    await runCycle({
      store,
      prices: memoryPriceSource({ EUR_USD: tf(candles) }),
      now: closeOf(candles.at(-1) as Candle),
      getStrategy: () => strategy,
    });
    expect(cursorsAtCommit).toEqual([
      `${candles[10]?.time}:1`,
      `${candles[14]?.time}:1`,
      `${candles[19]?.time}:0`,
    ]);
  });

  it("limits catch-up to 48 hours and logs the skip", async () => {
    const candles = m15Candles(4 * 24 * 3); // 3 days
    const { strategy, seen } = recorder("rec");
    const logs: Array<Record<string, unknown>> = [];
    const store = setup({
      candles: {},
      cursors: [{ pair: "EUR_USD", strategyId: "rec", lastCandleTime: candles[0]?.time ?? "" }],
    });
    const report = await runCycle({
      store,
      prices: memoryPriceSource({ EUR_USD: tf(candles) }),
      now: closeOf(candles.at(-1) as Candle),
      getStrategy: () => strategy,
      logger: (f) => logs.push(f),
    });
    expect(seen).toHaveLength(4 * 48 + 1); // latest and everything within 48 h of it
    expect(report.pairs[0]?.strategies[0]?.skippedOld).toBe(candles.length - 1 - seen.length);
    expect(logs.some((l) => l.outcome === "catch_up_limited")).toBe(true);
    expect(await store.loadCursor("EUR_USD", "rec")).toBe(candles.at(-1)?.time);
  });

  it("a pair that throws does not stop the others", async () => {
    const candles = m15Candles(6);
    const { strategy, seen } = recorder("rec");
    const good = memoryPriceSource({ GBP_USD: tf(candles) });
    const prices: PriceSource = {
      fetchClosedSince(pair, timeframe, from, now) {
        if (pair === "EUR_USD") throw new Error("OANDA down for EUR_USD");
        return good.fetchClosedSince(pair, timeframe, from, now);
      },
    };
    const store = setup({ pairs: ["EUR_USD", "GBP_USD"], candles: {} });
    const report = await runCycle({
      store,
      prices,
      now: closeOf(candles.at(-1) as Candle),
      getStrategy: () => strategy,
    });
    expect(report.pairs.map((p) => [p.pair, p.ok])).toEqual([
      ["EUR_USD", false],
      ["GBP_USD", true],
    ]);
    expect(seen).toEqual([candles.at(-1)?.time]);
    expect(report.status).toBe("degraded");
    expect(store.heartbeat?.status).toBe("degraded");
    expect(store.heartbeat?.lastOkAt).toBeUndefined();
  });

  it("runs LIVE and TEST strategies and skips OFF ones", async () => {
    const candles = m15Candles(6);
    const live = recorder("live");
    const test = recorder("test");
    const off = recorder("off");
    const all: Record<string, Strategy> = { live: live.strategy, test: test.strategy, off: off.strategy };
    const store = setup({
      candles: {},
      modes: [
        { strategyId: "live", mode: "LIVE" },
        { strategyId: "test", mode: "TEST" },
        { strategyId: "off", mode: "OFF" },
      ],
    });
    await runCycle({
      store,
      prices: memoryPriceSource({ EUR_USD: tf(candles) }),
      now: closeOf(candles.at(-1) as Candle),
      getStrategy: (id) => all[id] as Strategy,
    });
    expect(live.seen).toHaveLength(1);
    expect(test.seen).toHaveLength(1);
    expect(off.seen).toHaveLength(0);
  });

  it("two strategies can record the same sweep (unique per strategy)", async () => {
    const candles = m15Candles(6);
    const last = candles.at(-1) as Candle;
    const a = recorder("a", [last.time]);
    const b = recorder("b", [last.time]);
    const store = setup({
      candles: {},
      modes: [
        { strategyId: "a", mode: "LIVE" },
        { strategyId: "b", mode: "TEST" },
      ],
    });
    await runCycle({
      store,
      prices: memoryPriceSource({ EUR_USD: tf(candles) }),
      now: closeOf(last),
      getStrategy: (id) => (id === "a" ? a.strategy : b.strategy),
    });
    expect(store.listAlerts().map((x) => x.strategyId).sort()).toEqual(["a", "b"]);
  });

  it("reports degraded with no LIVE strategy, and skips unknown ids", async () => {
    const candles = m15Candles(4);
    const { strategy } = recorder("test-only");
    const store = setup({
      candles: {},
      modes: [
        { strategyId: "test-only", mode: "TEST" },
        { strategyId: "ghost", mode: "LIVE" },
      ],
    });
    const report = await runCycle({
      store,
      prices: memoryPriceSource({ EUR_USD: tf(candles) }),
      now: closeOf(candles.at(-1) as Candle),
      getStrategy: (id) => {
        if (id === "ghost") throw new Error("Unknown strategy");
        return strategy;
      },
    });
    expect(report.status).toBe("degraded");
    expect(report.message).toMatch(/unknown strategy "ghost"/);
    expect(report.message).toMatch(/no LIVE strategy/);
  });
});

describe("pendingCandleIndices", () => {
  const candles = m15Candles(10);
  it("returns nothing without candles", () => {
    expect(pendingCandleIndices([], "x")).toEqual({ indices: [], skippedOld: 0 });
  });
  it("returns candles after the cursor, oldest first", () => {
    expect(pendingCandleIndices(candles, candles[6]?.time ?? null).indices).toEqual([7, 8, 9]);
    expect(pendingCandleIndices(candles, candles[9]?.time ?? null).indices).toEqual([]);
  });
});

describe("cleanupIfDue", () => {
  it("deletes old candles once per UTC day", async () => {
    const old = m15Candles(2, Date.parse("2026-07-01T00:00:00Z")); // > 90 days before November
    const recent = m15Candles(2);
    const store = new MemoryStore({
      settings: SETTINGS,
      enabledPairs: ["EUR_USD"],
      strategyModes: [],
      candles: { EUR_USD: { M15: [...old, ...recent] } },
    });
    const now = new Date("2026-11-05T00:05:10Z");
    expect(await cleanupIfDue(store, now)).toBe(2);
    expect(store.candles.get("EUR_USD|M15")).toEqual(recent);
    expect(await cleanupIfDue(store, new Date("2026-11-05T12:00:00Z"))).toBeNull();
    expect(await cleanupIfDue(store, new Date("2026-11-06T00:00:10Z"))).toBe(0);
  });
});
