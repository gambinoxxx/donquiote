// Unit 16 Step 4: on an empty database the worker backfills candle history
// (90 days of M15, 365 days of H4 and D), then only fetches what is new.
import { describe, expect, it } from "vitest";
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { SETTINGS } from "@/lib/strategy/__fixtures__/candles";
import { RETENTION_MS, syncCandles } from "./cycle";
import type { PriceSource } from "./prices";
import { MemoryStore } from "./store";

const NOW = new Date("2026-11-10T12:00:10.000Z");
const DAY = 86_400_000;

function recordingSource(): PriceSource & { calls: Array<{ pair: Pair; timeframe: Timeframe; from: string }> } {
  const calls: Array<{ pair: Pair; timeframe: Timeframe; from: string }> = [];
  return {
    calls,
    async fetchClosedSince(pair, timeframe, fromIso) {
      calls.push({ pair, timeframe, from: fromIso });
      const c: Candle = { time: new Date(Date.parse(fromIso) + DAY).toISOString(), open: 1, high: 1, low: 1, close: 1 };
      return [c];
    },
  };
}

describe("empty database backfill", () => {
  it("first sync asks for the full retention window per timeframe, then only new candles", async () => {
    const store = new MemoryStore({ settings: SETTINGS, enabledPairs: ["EUR_USD"], strategyModes: [{ strategyId: "dg-v1", mode: "LIVE" }] });
    const prices = recordingSource();
    const saved = await syncCandles({ store, prices, now: NOW }, "EUR_USD");
    expect(saved).toEqual({ D: 1, H4: 1, M15: 1 });
    expect(prices.calls.map((c) => [c.timeframe, (NOW.getTime() - Date.parse(c.from)) / DAY])).toEqual([
      ["D", 365],
      ["H4", 365],
      ["M15", 90],
    ]);
    expect(RETENTION_MS.M15).toBe(90 * DAY);

    prices.calls.length = 0;
    await syncCandles({ store, prices, now: NOW }, "EUR_USD");
    // Second run starts from the newest stored candle, not the full window.
    for (const c of prices.calls) expect((NOW.getTime() - Date.parse(c.from)) / DAY).toBeLessThan(365);
    expect(prices.calls.find((c) => c.timeframe === "M15")!.from).toBe(new Date(NOW.getTime() - 90 * DAY + DAY).toISOString());
  });
});
