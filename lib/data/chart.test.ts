import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@/lib/types";
import { daily, h4, JPY_HALF_RANGE, JPY_UP, m15, M15_START, SETTINGS, EUR_DOWN, EUR_HALF_RANGE } from "@/lib/strategy/__fixtures__/candles";
import { getV2LiquidityLevels } from "@/lib/strategy/dg-v2-candidate/levels";
import { getLiquidityLevels } from "@/lib/strategy/shared/liquidity";
import { getTrend } from "@/lib/strategy/shared/trend";

vi.mock("server-only", () => ({}));
const db = {
  candle: { findMany: vi.fn() },
  settings: { findUniqueOrThrow: vi.fn() },
  strategyConfig: { findMany: vi.fn() },
  alert: { findMany: vi.fn(), findFirst: vi.fn() },
  watchlistPair: { findMany: vi.fn() },
};
vi.mock("@/lib/db/client", () => ({ getDb: () => db }));

const { getCandles, getChartContext, getChartPairs } = await import("./chart");
const { clampLimit, computeChartLevels } = await import("./chart-logic");
const { barTimeFor, formatChartTick, formatChartTime } = await import("./format");
const { buildChartSummary } = await import("@/lib/summary");

const M15_MS = 15 * 60_000;
const row = (iso: string, price = 1.1) => ({ pair: "EUR_USD", timeframe: "M15", time: new Date(iso), open: price, high: price + 0.001, low: price - 0.001, close: price });
const asDb = (candles: Candle[]) => candles.map((c) => ({ time: new Date(c.time), open: c.open, high: c.high, low: c.low, close: c.close }));

beforeEach(() => vi.clearAllMocks());

describe("getCandles", () => {
  const NOW = new Date("2026-11-04T10:07:00.000Z"); // the 10:00 candle is still forming

  it("asks for closed candles only (opened by now − 15 min), newest first, and returns them oldest first", async () => {
    db.candle.findMany.mockResolvedValue([row("2026-11-04T09:45:00.000Z"), row("2026-11-04T09:30:00.000Z"), row("2026-11-04T09:15:00.000Z")]);
    const page = await getCandles("EUR_USD", "M15", {}, NOW);
    const args = db.candle.findMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({ pair: "EUR_USD", timeframe: "M15", time: { lte: new Date("2026-11-04T09:52:00.000Z") } });
    expect(args.orderBy).toEqual({ time: "desc" });
    expect(page.candles.map((c) => new Date(c.time * 1000).toISOString())).toEqual([
      "2026-11-04T09:15:00.000Z",
      "2026-11-04T09:30:00.000Z",
      "2026-11-04T09:45:00.000Z",
    ]);
    expect(page.hasMore).toBe(false);
  });

  it("drops a candle that has not closed even if the database returns it", async () => {
    db.candle.findMany.mockResolvedValue([row("2026-11-04T10:00:00.000Z"), row("2026-11-04T09:45:00.000Z")]);
    const page = await getCandles("EUR_USD", "M15", {}, NOW);
    expect(page.candles).toHaveLength(1);
  });

  it("limit: default 500, capped at 1,000 (one extra row tells if there is more)", async () => {
    db.candle.findMany.mockResolvedValue([]);
    await getCandles("EUR_USD", "M15", {}, NOW);
    await getCandles("EUR_USD", "M15", { limit: 5000 }, NOW);
    expect(db.candle.findMany.mock.calls.map((c) => c[0].take)).toEqual([501, 1001]);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(undefined)).toBe(500);
  });

  it("before: older history only, and hasMore when a full page came back", async () => {
    const before = Date.parse("2026-11-04T09:00:00.000Z") / 1000;
    db.candle.findMany.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => row(new Date(Date.parse("2026-11-04T08:45:00.000Z") - i * M15_MS).toISOString())),
    );
    const page = await getCandles("EUR_USD", "M15", { before, limit: 3 }, NOW);
    expect(db.candle.findMany.mock.calls[0]?.[0].where.time).toEqual({
      lte: new Date("2026-11-04T09:52:00.000Z"),
      lt: new Date("2026-11-04T09:00:00.000Z"),
    });
    expect(page.candles).toHaveLength(3);
    expect(page.candles.every((c) => c.time < before)).toBe(true);
    expect(page.hasMore).toBe(true);
  });

  it("daily candles: closed once the forex day ended", async () => {
    db.candle.findMany.mockResolvedValue([]);
    await getCandles("EUR_USD", "D", {}, NOW);
    expect(db.candle.findMany.mock.calls[0]?.[0].where.time.lte).toEqual(new Date("2026-11-03T10:07:00.000Z"));
  });
});

describe("chart levels = what lib/strategy returns for the same candles", () => {
  // USD_JPY: 15m equal lows (dg-v1 scenario 6) on an uptrend.
  const D = daily(JPY_UP, JPY_HALF_RANGE, 3);
  const H4 = h4(JPY_UP, JPY_HALF_RANGE, 3);
  const M15 = m15(M15_START, [
    [157.05, 157.1, 157.0, 157.02],
    [157.02, 157.05, 156.95, 157.0],
    [157.0, 157.0, 156.9, 156.95],
    [157.0, 157.1, 156.98, 157.05],
    [157.05, 157.2, 157.05, 157.15],
    [157.15, 157.15, 157.0, 157.05],
    [157.05, 157.05, 156.95, 157.0],
    [157.0, 157.0, 156.915, 156.95],
    [156.97, 157.08, 156.97, 157.05],
    [157.05, 157.1, 157.0, 157.05],
  ]);

  it("previous day, equal highs/lows and trends come from the scanner's functions", () => {
    const out = computeChartLevels({ pair: "USD_JPY", D, H4, M15, settings: SETTINGS });
    const direct = getLiquidityLevels({ pair: "USD_JPY", candles: { D, M15 }, settings: SETTINGS });
    expect(out.levels.filter((l) => l.kind !== "ASH" && l.kind !== "ASL")).toEqual(
      direct.map((l) => ({ kind: l.type, price: l.price, since: l.since })),
    );
    expect(out.trendD).toBe(getTrend(D, SETTINGS.swingStrength));
    expect(out.trendH4).toBe(getTrend(H4, SETTINGS.swingStrength));
    expect(out).toMatchInlineSnapshot(`
      {
        "levels": [
          {
            "kind": "PDH",
            "price": 156.7,
            "since": "2026-11-02T22:00:00.000Z",
          },
          {
            "kind": "PDL",
            "price": 156.3,
            "since": "2026-11-02T22:00:00.000Z",
          },
          {
            "kind": "EQL",
            "price": 156.9,
            "since": "2026-11-03T22:30:00.000Z",
          },
        ],
        "trendD": "UP",
        "trendH4": "UP",
      }
    `);
  });

  it("the Asian session high/low is dg-v2-candidate's, once the session has ended", () => {
    const D2 = daily(EUR_DOWN, EUR_HALF_RANGE);
    const rows: Array<readonly [number, number, number, number]> = Array.from({ length: 38 }, () => [1.104, 1.1045, 1.1035, 1.104] as const);
    rows[10] = [1.104, 1.1052, 1.1035, 1.1045];
    const M = m15(M15_START, rows); // 22:00 → 07:15 UTC
    const out = computeChartLevels({ pair: "EUR_USD", D: D2, H4: h4(EUR_DOWN, EUR_HALF_RANGE), M15: M, settings: SETTINGS });
    const last = M.at(-1) as Candle;
    const next = { ...last, time: new Date(Date.parse(last.time) + M15_MS).toISOString() };
    const direct = getV2LiquidityLevels({ pair: "EUR_USD", D: D2, history: M, candle: next, settings: SETTINGS })
      .filter((l) => l.type === "ASH" || l.type === "ASL")
      .map((l) => ({ kind: l.type, price: l.price, since: l.since }));
    expect(out.levels.filter((l) => l.kind === "ASH" || l.kind === "ASL")).toEqual(direct);
    expect(direct).toEqual([
      { kind: "ASH", price: 1.1052, since: "2026-11-04T07:00:00.000Z" },
      { kind: "ASL", price: 1.1035, since: "2026-11-04T07:00:00.000Z" },
    ]);
    // Before 07:00 UTC there is no Asian level yet (the next candle opens 06:45).
    const early = computeChartLevels({ pair: "EUR_USD", D: D2, H4: [], M15: M.slice(0, 35), settings: SETTINGS });
    expect(early.levels.some((l) => l.kind === "ASH")).toBe(false);
    // From the 06:45 candle's close the next candle opens at 07:00: the level exists.
    const at7 = computeChartLevels({ pair: "EUR_USD", D: D2, H4: [], M15: M.slice(0, 36), settings: SETTINGS });
    expect(at7.levels.some((l) => l.kind === "ASH")).toBe(true);
  });

  it("getChartContext computes them from the stored candles the same way", async () => {
    const now = new Date(Date.parse(M15.at(-1)?.time as string) + M15_MS + 10_000);
    db.candle.findMany.mockImplementation(async ({ where }: { where: { timeframe: string } }) =>
      asDb(where.timeframe === "D" ? D : where.timeframe === "H4" ? H4 : M15).reverse(),
    );
    db.settings.findUniqueOrThrow.mockResolvedValue({ swingStrength: 2, equalTolerancePips: 2 });
    db.strategyConfig.findMany.mockResolvedValue([{ strategyId: "dg-v1", mode: "LIVE" }]);
    db.alert.findMany.mockResolvedValue([]);
    const ctx = await getChartContext("USD_JPY", "M15", { from: Date.parse(M15_START) / 1000 }, now);
    expect(ctx.levels).toEqual(computeChartLevels({ pair: "USD_JPY", D, H4, M15, settings: SETTINGS }).levels);
    expect(ctx).toMatchObject({ decimals: 3, trendD: "UP", trendH4: "UP", lastClose: 157.05, alerts: [], active: [] });
  });

  it("pairs: enabled first", async () => {
    db.watchlistPair.findMany.mockResolvedValue([
      { pair: "EUR_USD", enabled: true },
      { pair: "XAU_USD", enabled: false },
      { pair: "USD_JPY", enabled: true },
    ]);
    expect((await getChartPairs()).map((p) => p.pair)).toEqual(["EUR_USD", "USD_JPY", "XAU_USD"]);
  });
});

describe("chart labels in Lagos time", () => {
  const t = Date.parse("2026-11-04T13:15:00.000Z") / 1000; // 14:15 Lagos
  it("crosshair and ticks", () => {
    expect(formatChartTime(t, "M15")).toBe("Wed 4 Nov · 14:15");
    expect(formatChartTime(t, "D")).toBe("Wed, 4 Nov");
    expect(formatChartTick(t, 3)).toBe("14:15");
    expect(formatChartTick(t, 2)).toBe("4 Nov");
    expect(formatChartTick(t, 1)).toBe("Nov");
    expect(formatChartTick(t, 0)).toBe("2026");
    // 23:30 UTC is already the next day in Lagos.
    expect(formatChartTick(Date.parse("2026-11-04T23:30:00.000Z") / 1000, 3)).toBe("00:30");
  });
  it("barTimeFor snaps a time to the bar that contains it", () => {
    const bars = [100, 200, 300];
    expect(barTimeFor(new Date(250_000).toISOString(), bars)).toBe(200);
    expect(barTimeFor(new Date(300_000).toISOString(), bars)).toBe(300);
    expect(barTimeFor(new Date(50_000).toISOString(), bars)).toBeNull();
  });
});

describe("buildChartSummary", () => {
  const input = {
    pair: "USD_JPY" as const,
    timeframe: "M15" as const,
    lastPrice: 157.05,
    lastCandleClose: "2026-11-04T13:15:00.000Z",
    trendD: "UP",
    trendH4: "UP",
    levels: [
      { kind: "PDH", price: 156.7 },
      { kind: "EQL", price: 156.9 },
    ],
    alerts: [
      {
        direction: "BUY" as const,
        status: "READY",
        strategyName: "DG v1 · Original",
        live: true,
        entryType: "MARKET" as const,
        entry: 157.25,
        stop: 156.85,
        target: 158.45,
        stopPips: 40,
        targetPips: 120,
        lotSize: 0.19,
      },
    ],
  };

  it("pair, timeframe, last price, trends, levels, alerts with tickets, closed-candles note (JPY 3 decimals)", () => {
    const text = buildChartSummary(input);
    expect(text).toContain("Pair: USD/JPY | Timeframe: 15m | Last price: 157.050 (last closed candle Wed 4 Nov · 14:15 Lagos)");
    expect(text).toContain("Trend: Daily up, 4H up (aligned)");
    expect(text).toContain("- Equal lows: 156.900");
    expect(text).toContain("- Previous day high: 156.700");
    expect(text).toContain("- BUY · READY · DG v1 · Original (live) | Entry 157.250 | Stop 156.850 (40 pips) | Target 158.450 (120 pips) | 0.19 lots");
    expect(text).toContain("Prices are from closed candles only");
  });

  it("no levels or alerts, mixed trends", () => {
    const text = buildChartSummary({ ...input, pair: "EUR_USD", lastPrice: 1.1, trendH4: "DOWN", levels: [], alerts: [] });
    expect(text).toContain("Last price: 1.10000");
    expect(text).toContain("Trend: Daily up, 4H down (not aligned)");
    expect(text).toContain("- none right now");
    expect(text).toContain("Active alerts on this pair:\n- none");
  });
});

describe("dayChange", () => {
  it("is measured from the forex-day open of the last candle (Friday's change at the weekend)", async () => {
    const { dayChange } = await import("./chart-logic");
    // Thu 5 Nov 22:00 UTC is the forex-day open (17:00 New York).
    const candles = m15("2026-11-05T21:30:00.000Z", [
      [1.1, 1.1, 1.1, 1.1],
      [1.1, 1.1, 1.1, 1.1005],
      [1.1005, 1.101, 1.1, 1.1008], // 22:00 opens the day at 1.1005
      [1.1008, 1.103, 1.1, 1.1025], // last close 1.1025 → +20 pips
    ]);
    expect(dayChange("EUR_USD", candles)).toMatchObject({ openPrice: 1.1005, changePips: 20, changePct: 0.18 });
  });
});
