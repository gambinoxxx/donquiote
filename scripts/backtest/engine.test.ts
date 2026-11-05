import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/types";
import {
  daily,
  EUR_DOWN,
  EUR_HALF_RANGE,
  h4,
  m15,
  M15_START,
  SETTINGS,
} from "@/lib/strategy/__fixtures__/candles";
import { dgV1 } from "@/lib/strategy/dg-v1";
import type { Strategy } from "@/lib/strategy/types";
import { assertNoLookAhead, runBacktest } from "./engine";

type Row = readonly [number, number, number, number];

const D = daily(EUR_DOWN, EUR_HALF_RANGE);
const H4 = h4(EUR_DOWN, EUR_HALF_RANGE);
// Same path as dg-v1 scenario 1: sweep PDH at c6, body close below 1.10150 at c7.
const SETUP_ROWS: Row[] = [
  [1.1035, 1.104, 1.103, 1.1032],
  [1.1032, 1.1035, 1.1025, 1.1028],
  [1.1028, 1.103, 1.1015, 1.1025],
  [1.103, 1.104, 1.1028, 1.1035],
  [1.1035, 1.105, 1.1035, 1.1045],
  [1.1045, 1.106, 1.1045, 1.1055],
  [1.1055, 1.1078, 1.105, 1.106], // c6 sweep
  [1.1058, 1.1062, 1.1005, 1.101], // c7 confirm: entry 1.10100, stop 1.10810, target 1.07970
];
const FALLS_TO_TARGET: Row[] = [
  [1.101, 1.1015, 1.095, 1.096],
  [1.096, 1.0965, 1.0795, 1.08], // low 1.07950 ≤ target
];
const RISES_TO_STOP: Row[] = [
  [1.101, 1.1085, 1.1005, 1.108], // high 1.10850 ≥ stop
  [1.108, 1.109, 1.107, 1.108],
];

function run(rows: Row[], strategy: Strategy = dgV1) {
  const M15 = m15(M15_START, rows);
  return runBacktest({
    strategy,
    pair: "EUR_USD",
    candles: { D, H4, M15 },
    settings: SETTINGS,
    fromMs: Date.parse(M15_START),
    toMs: Date.parse("2026-11-10T00:00:00Z"),
  });
}

describe("runBacktest", () => {
  it("turns SWEEP → CONFIRM into a paper trade and resolves it with later candles", () => {
    const { setups, trades, steps } = run([...SETUP_ROWS, ...FALLS_TO_TARGET]);
    expect(steps).toBe(10);
    expect(setups).toHaveLength(1);
    expect(setups[0]).toMatchObject({ status: "CONFIRMED", sweepType: "PDH", confirmTime: "2026-11-03T23:45:00.000Z" });
    expect(trades).toHaveLength(1);
    expect(trades[0]?.trade).toEqual({
      pair: "EUR_USD",
      direction: "SELL",
      entry: 1.101,
      stop: 1.1081,
      target: 1.0797,
      riskUsd: 50,
      openedAt: "2026-11-04T00:00:00.000Z", // close of the confirming candle
    });
    expect(trades[0]?.result).toMatchObject({ status: "WIN", resultR: 3, pnlUsd: 150, closedAt: "2026-11-04T00:30:00.000Z" });
  });

  it("records a loss when price hits the stop first", () => {
    const { trades } = run([...SETUP_ROWS, ...RISES_TO_STOP]);
    expect(trades[0]?.result).toMatchObject({ status: "LOSS", resultR: -1, pnlUsd: -50 });
  });

  it("leaves a trade OPEN at the end of the data", () => {
    const { trades } = run(SETUP_ROWS);
    expect(trades[0]?.result).toEqual({ status: "OPEN" });
  });

  it("only evaluates candles from `from`; earlier ones are history", () => {
    const M15 = m15(M15_START, [...SETUP_ROWS, ...FALLS_TO_TARGET]);
    const out = runBacktest({
      strategy: dgV1,
      pair: "EUR_USD",
      candles: { D, H4, M15 },
      settings: SETTINGS,
      fromMs: Date.parse("2026-11-03T23:45:00Z"), // after the sweep candle
      toMs: Date.parse("2026-11-10T00:00:00Z"),
    });
    expect(out.setups).toEqual([]);
    expect(out.steps).toBe(3);
  });
});

describe("no look-ahead", () => {
  it("a later candle cannot change an earlier event", () => {
    const withWin = run([...SETUP_ROWS, ...FALLS_TO_TARGET]);
    const withLoss = run([...SETUP_ROWS, ...RISES_TO_STOP]);
    // Everything decided up to the confirming candle is identical...
    expect(withLoss.setups).toEqual(withWin.setups);
    expect(withLoss.trades.map((t) => [t.ticket, t.trade])).toEqual(
      withWin.trades.map((t) => [t.ticket, t.trade]),
    );
    // ...only the outcome, decided by the later candles, differs.
    expect(withWin.trades[0]?.result.status).toBe("WIN");
    expect(withLoss.trades[0]?.result.status).toBe("LOSS");
  });

  it("the strategy never receives a candle that closes after `now`", () => {
    const seen: Array<{ now: number; latest: Record<string, number> }> = [];
    const spy: Strategy = {
      ...dgV1,
      evaluate(input) {
        const latest = Object.fromEntries(
          (["D", "H4", "M15"] as const).map((tf) => [tf, Date.parse(input.candles[tf].at(-1)?.time ?? "0")]),
        );
        seen.push({ now: input.now.getTime(), latest });
        return dgV1.evaluate(input);
      },
    };
    run([...SETUP_ROWS, ...FALLS_TO_TARGET], spy);
    expect(seen).toHaveLength(10);
    for (const { now, latest } of seen) {
      expect(latest.M15! + 15 * 60_000).toBeLessThanOrEqual(now);
      expect(latest.H4! + 4 * 3_600_000).toBeLessThanOrEqual(now);
      expect(latest.D! + 24 * 3_600_000).toBeLessThanOrEqual(now);
    }
  });

  it("assertNoLookAhead throws for a candle closing after t", () => {
    const candle: Candle = { time: "2026-11-04T00:00:00.000Z", open: 1, high: 1, low: 1, close: 1 };
    const input = {
      pair: "EUR_USD" as const,
      now: new Date("2026-11-04T00:15:00.000Z"),
      candles: { D: [], H4: [], M15: [candle] },
      settings: SETTINGS,
      openSetups: [],
    };
    expect(() => assertNoLookAhead(input, Date.parse("2026-11-04T00:15:00Z"))).not.toThrow();
    expect(() => assertNoLookAhead(input, Date.parse("2026-11-04T00:14:59Z"))).toThrow(/Look-ahead/);
    expect(() =>
      assertNoLookAhead({ ...input, candles: { D: [candle], H4: [], M15: [] } }, Date.parse("2026-11-04T12:00:00Z")),
    ).toThrow(/Look-ahead: D/);
  });
});
