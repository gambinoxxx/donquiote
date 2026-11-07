// After a settings save, the next cycle uses the new values: the worker reads
// Settings, the watchlist and strategy modes at the start of every cycle.
import { describe, expect, it } from "vitest";
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { SETTINGS } from "@/lib/strategy/__fixtures__/candles";
import type { Strategy, StrategyInput, StrategySettings } from "@/lib/strategy/types";
import { runCycle } from "./cycle";
import { memoryPriceSource } from "./prices";
import { MemoryStore } from "./store";

const M15 = 15 * 60_000;
const START = Date.parse("2026-11-04T08:00:00.000Z");
const candles: Candle[] = Array.from({ length: 6 }, (_, i) => ({ time: new Date(START + i * M15).toISOString(), open: 1.1, high: 1.1005, low: 1.0995, close: 1.1 }));
const tf = (c: Candle[]): Record<Timeframe, Candle[]> => ({ D: [], H4: [], M15: c });

describe("settings take effect on the next cycle", () => {
  it("new strategy numbers, a pair switched off and a mode change are all picked up", async () => {
    const seen: Array<{ pair: Pair; settings: StrategySettings }> = [];
    const strategy = (id: string): Strategy => ({
      id,
      name: id,
      description: "records its input",
      evaluate(input: StrategyInput) {
        seen.push({ pair: input.pair, settings: input.settings });
        return [];
      },
    });
    const store = new MemoryStore({
      settings: SETTINGS,
      enabledPairs: ["EUR_USD", "GBP_USD"],
      strategyModes: [
        { strategyId: "dg-v1", mode: "LIVE" },
        { strategyId: "pro", mode: "OFF" },
      ],
    });
    for (const pair of ["EUR_USD", "GBP_USD"]) store.cursors.set(`${pair}|dg-v1`, candles[0]?.time as string);
    const prices = memoryPriceSource({ EUR_USD: tf(candles), GBP_USD: tf(candles) });
    const run = (i: number) =>
      runCycle({ store, prices, now: new Date(START + (i + 1) * M15 + 10_000), getStrategy: (id) => strategy(id) });

    await run(2);
    expect(new Set(seen.map((s) => s.pair))).toEqual(new Set(["EUR_USD", "GBP_USD"]));
    expect(seen.every((s) => s.settings.stopBufferPips === 3)).toBe(true);

    // What saveSettings writes (Settings, WatchlistPair, StrategyConfig) — PrismaStore reads the same each cycle.
    store.settings = { ...SETTINGS, stopBufferPips: 5, equalTolerancePips: 1.5 };
    store.enabledPairs = ["EUR_USD"];
    store.strategyModes = [
      { strategyId: "dg-v1", mode: "LIVE" },
      { strategyId: "pro", mode: "TEST" },
    ];
    seen.length = 0;
    await run(3);
    expect(seen.map((s) => s.pair).every((p) => p === "EUR_USD")).toBe(true);
    expect(seen.every((s) => s.settings.stopBufferPips === 5 && s.settings.equalTolerancePips === 1.5)).toBe(true);
    // "pro" is now TEST, so it runs too (first run: the latest candle only).
    expect(seen.length).toBe(2);
  });
});
