import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/types";
import {
  daily,
  EUR_DOWN,
  EUR_HALF_RANGE,
  EUR_UP,
  m15,
  M15_START,
  SETTINGS,
  waveCandles,
} from "../__fixtures__/candles";
import type { OpenSetup } from "../types";
import { detectBos } from "./bos";
import { getLiquidityLevels } from "./liquidity";
import { detectSweep, extendsSweep, tradeDirection } from "./sweep";
import { findSwings } from "./swings";
import { getTrend } from "./trend";

const H = 3_600_000;
const hl = (pairs: ReadonlyArray<readonly [number, number]>): Candle[] =>
  pairs.map(([high, low], i) => ({
    time: new Date(Date.parse("2026-11-03T00:00:00Z") + i * H).toISOString(),
    open: (high + low) / 2,
    high,
    low,
    close: (high + low) / 2,
  }));

describe("findSwings", () => {
  it("finds a swing high strictly above `strength` candles on each side", () => {
    const candles = hl([[1, 0], [2, 0.5], [5, 1], [3, 0.8], [2, 0.6]]);
    const { highs } = findSwings(candles, 2);
    expect(highs).toEqual([{ index: 2, time: candles[2]?.time, price: 5 }]);
  });

  it("does not count ties as swings", () => {
    const candles = hl([[1, 0], [2, 0.5], [5, 1], [5, 0.8], [2, 0.6], [1, 0.4]]);
    expect(findSwings(candles, 2).highs).toEqual([]);
  });

  it("needs `strength` closed candles after the swing", () => {
    const candles = hl([[1, 0.5], [2, 0.6], [5, 1], [3, 0.8]]);
    expect(findSwings(candles, 2).highs).toEqual([]);
    expect(findSwings(candles, 1).highs.map((s) => s.index)).toEqual([2]);
  });

  it("finds swing lows the same way", () => {
    const candles = hl([[5, 3], [5, 2], [5, 0.5], [5, 1.5], [5, 2.5]]);
    expect(findSwings(candles, 2).lows.map((s) => s.price)).toEqual([0.5]);
  });

  it("rejects a strength below 1", () => {
    expect(() => findSwings([], 0)).toThrow(RangeError);
  });
});

describe("getTrend", () => {
  const start = "2026-01-01T22:00:00.000Z";
  it("is DOWN for lower highs and lower lows", () => {
    expect(getTrend(waveCandles(EUR_DOWN, EUR_HALF_RANGE, start, 24 * H), 2)).toBe("DOWN");
  });
  it("is UP for higher highs and higher lows", () => {
    expect(getTrend(waveCandles(EUR_UP, EUR_HALF_RANGE, start, 24 * H), 2)).toBe("UP");
  });
  it("is RANGE for a higher high with a lower low", () => {
    // Expanding wave: peaks 3 → 5, troughs 0 → -2.
    const values = [1, 2, 3, 2, 1, 0, -1, 0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, -1, -2, -1, 0];
    expect(getTrend(waveCandles(values, 0.1, start, H), 2)).toBe("RANGE");
  });
  it("is RANGE with fewer than two swing highs and lows", () => {
    expect(getTrend(waveCandles([1, 2, 3, 2, 1], 0.1, start, H), 2)).toBe("RANGE");
  });
});

describe("getLiquidityLevels", () => {
  const D = daily(EUR_DOWN, EUR_HALF_RANGE);

  it("uses the last closed daily candle for PDH / PDL", () => {
    const levels = getLiquidityLevels({ pair: "EUR_USD", candles: { D, M15: [] }, settings: SETTINGS });
    expect(levels).toEqual([
      { type: "PDH", price: 1.107, since: D.at(-1)?.time },
      { type: "PDL", price: 1.103, since: D.at(-1)?.time },
    ]);
  });

  // Two swing highs 1.5 pips apart, then a third 5 pips away.
  const rows: Array<[number, number, number, number]> = [
    [1.1, 1.1005, 1.0995, 1.1],
    [1.1, 1.101, 1.0998, 1.1],
    [1.1, 1.103, 1.1, 1.1], // swing high 1.10300
    [1.1, 1.101, 1.0998, 1.1],
    [1.1, 1.1005, 1.0995, 1.1],
    [1.1, 1.101, 1.0998, 1.1],
    [1.1, 1.10315, 1.1, 1.1], // swing high 1.10315 (1.5 pips from 1.10300)
    [1.1, 1.101, 1.0998, 1.1],
    [1.1, 1.1005, 1.0995, 1.1],
    [1.1, 1.101, 1.0998, 1.1],
    [1.1, 1.1037, 1.1, 1.1], // swing high 1.10370 (too far)
    [1.1, 1.101, 1.0998, 1.1],
    [1.1, 1.1005, 1.0995, 1.1],
  ];

  it("groups M15 swing highs within the tolerance into one EQH at the highest high", () => {
    const M15 = m15(M15_START, rows);
    const eq = getLiquidityLevels({ pair: "EUR_USD", candles: { D, M15 }, settings: SETTINGS }).filter(
      (l) => l.type === "EQH",
    );
    expect(eq).toEqual([{ type: "EQH", price: 1.10315, since: M15[2]?.time }]);
  });

  it("finds no equal highs when the tolerance is tighter than the gap", () => {
    const M15 = m15(M15_START, rows);
    const levels = getLiquidityLevels({
      pair: "EUR_USD",
      candles: { D, M15 },
      settings: { ...SETTINGS, equalTolerancePips: 1 },
    });
    expect(levels.filter((l) => l.type === "EQH")).toEqual([]);
  });

  it("ignores swings before the previous forex day", () => {
    const M15 = m15("2026-11-01T22:00:00.000Z", rows); // before D's last open (2 Nov 22:00)
    const levels = getLiquidityLevels({ pair: "EUR_USD", candles: { D, M15 }, settings: SETTINGS });
    expect(levels.filter((l) => l.type === "EQH")).toEqual([]);
  });

  it("uses JPY pips for the tolerance", () => {
    const jpyRows = rows.map(
      (r) => r.map((v) => Number((v * 100 + 47).toFixed(3))) as [number, number, number, number],
    );
    // Highs 157.300 and 157.315 (1.5 JPY pips) group; 157.370 does not.
    const M15 = m15(M15_START, jpyRows);
    const eq = getLiquidityLevels({
      pair: "USD_JPY",
      candles: { D: daily([156], 0.2, 3), M15 },
      settings: SETTINGS,
    }).filter((l) => l.type === "EQH");
    expect(eq.map((l) => l.price)).toEqual([157.315]);
  });
});

describe("tradeDirection", () => {
  it("needs D and H4 to agree", () => {
    expect(tradeDirection("DOWN", "DOWN")).toBe("SELL");
    expect(tradeDirection("UP", "UP")).toBe("BUY");
    expect(tradeDirection("DOWN", "UP")).toBeNull();
    expect(tradeDirection("UP", "RANGE")).toBeNull();
    expect(tradeDirection("RANGE", "RANGE")).toBeNull();
  });
});

describe("detectSweep", () => {
  const history = m15(M15_START, [
    [1.1035, 1.104, 1.103, 1.1032],
    [1.1032, 1.1035, 1.1025, 1.1028],
    [1.1028, 1.103, 1.1015, 1.1025], // swing low 1.10150
    [1.103, 1.104, 1.1028, 1.1035],
    [1.1035, 1.105, 1.1035, 1.1045],
  ]);
  const candle: Candle = {
    time: "2026-11-03T23:15:00.000Z",
    open: 1.1045,
    high: 1.1078,
    low: 1.104,
    close: 1.106,
  };
  const levels = [
    { type: "PDH" as const, price: 1.107, since: "2026-11-02T22:00:00.000Z" },
    { type: "EQH" as const, price: 1.1075, since: "2026-11-03T22:00:00.000Z" },
    { type: "PDL" as const, price: 1.103, since: "2026-11-02T22:00:00.000Z" },
  ];
  const base = { pair: "EUR_USD" as const, trendD: "DOWN" as const, trendH4: "DOWN" as const, levels, history, candle, settings: SETTINGS };

  it("sweeps the furthest level traded through and sets BOS and expiry", () => {
    expect(detectSweep(base)).toEqual({
      dedupeKey: "EUR_USD:SELL:2026-11-03T23:15:00.000Z",
      direction: "SELL",
      sweepType: "EQH",
      sweepLevel: 1.1075,
      sweepExtreme: 1.1078,
      sweepTime: "2026-11-03T23:15:00.000Z",
      bosLevel: 1.1015,
      expiresAt: "2026-11-04T01:30:00.000Z",
    });
  });

  it("returns null when the trends disagree", () => {
    expect(detectSweep({ ...base, trendH4: "UP" })).toBeNull();
  });

  it("returns null when the high does not trade above a level", () => {
    expect(detectSweep({ ...base, candle: { ...candle, high: 1.107 } })).toBeNull();
  });

  it("returns null when the level was already traded through", () => {
    const touched = [...history, { ...candle, time: "2026-11-03T23:10:00.000Z", high: 1.108 }];
    expect(detectSweep({ ...base, history: touched })).toBeNull();
  });

  it("returns null without a confirmed swing for the BOS level", () => {
    expect(detectSweep({ ...base, history: history.slice(0, 3) })).toBeNull();
  });

  it("only looks at PDL/EQL for BUY setups, with the last swing high as BOS", () => {
    const buyHistory = m15(M15_START, [
      [1.103, 1.104, 1.102, 1.103],
      [1.103, 1.1045, 1.1025, 1.104],
      [1.104, 1.106, 1.103, 1.105], // swing high 1.10600
      [1.105, 1.1045, 1.1025, 1.103],
      [1.103, 1.104, 1.102, 1.1025],
    ]);
    const buyLevels = [
      { type: "PDH" as const, price: 1.103, since: "2026-11-02T22:00:00.000Z" }, // ignored for BUY
      { type: "PDL" as const, price: 1.101, since: "2026-11-02T22:00:00.000Z" },
    ];
    const buy = detectSweep({
      ...base,
      trendD: "UP",
      trendH4: "UP",
      levels: buyLevels,
      history: buyHistory,
      candle: { ...candle, high: 1.1035, low: 1.1005 },
    });
    expect(buy).toMatchObject({
      direction: "BUY",
      sweepType: "PDL",
      sweepLevel: 1.101,
      sweepExtreme: 1.1005,
      bosLevel: 1.106,
    });
  });
});

describe("detectBos", () => {
  const setup: OpenSetup = {
    dedupeKey: "k",
    direction: "SELL",
    sweepType: "PDH",
    sweepLevel: 1.107,
    sweepExtreme: 1.1078,
    sweepTime: "2026-11-03T23:30:00.000Z",
    bosLevel: 1.1015,
    expiresAt: "2026-11-04T01:45:00.000Z",
  };
  const at = (time: string, low: number, close: number): Candle => ({ time, open: 1.104, high: 1.105, low, close });

  it("confirms on a body close beyond the level", () => {
    expect(detectBos(setup, at("2026-11-03T23:45:00.000Z", 1.1005, 1.101))).toBe("CONFIRM");
  });
  it("does not confirm on a wick only", () => {
    expect(detectBos(setup, at("2026-11-03T23:45:00.000Z", 1.1005, 1.102))).toBeNull();
  });
  it("does not confirm on a close exactly at the level", () => {
    expect(detectBos(setup, at("2026-11-03T23:45:00.000Z", 1.1005, 1.1015))).toBeNull();
  });
  it("expires once a candle closes after expiresAt, even with a body close", () => {
    expect(detectBos(setup, at("2026-11-04T01:30:00.000Z", 1.1005, 1.101))).toBe("CONFIRM");
    expect(detectBos(setup, at("2026-11-04T01:45:00.000Z", 1.1005, 1.101))).toBe("EXPIRE");
  });
  it("ignores the sweep candle itself", () => {
    expect(detectBos(setup, at("2026-11-03T23:30:00.000Z", 1.1005, 1.101))).toBeNull();
  });
  it("mirrors for BUY", () => {
    const buy = { ...setup, direction: "BUY" as const, bosLevel: 157.2 };
    expect(detectBos(buy, { ...at("2026-11-03T23:45:00.000Z", 157, 157.25), high: 157.3 })).toBe("CONFIRM");
    expect(detectBos(buy, { ...at("2026-11-03T23:45:00.000Z", 157, 157.15), high: 157.3 })).toBeNull();
  });
});

describe("extendsSweep", () => {
  it("is true only beyond the current extreme", () => {
    const setup = { direction: "SELL", sweepExtreme: 1.1078 } as OpenSetup;
    const c = (high: number, low: number) => ({ time: "t", open: 0, close: 0, high, low });
    expect(extendsSweep(setup, c(1.1079, 1.1))).toBe(true);
    expect(extendsSweep(setup, c(1.1078, 1.1))).toBe(false);
    const buy = { direction: "BUY", sweepExtreme: 156.88 } as OpenSetup;
    expect(extendsSweep(buy, c(157, 156.87))).toBe(true);
    expect(extendsSweep(buy, c(157, 156.88))).toBe(false);
  });
});
