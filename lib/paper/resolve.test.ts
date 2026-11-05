import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/types";
import {
  NOTE_GAPPED_STOP,
  NOTE_GAPPED_TARGET,
  NOTE_SAME_CANDLE,
  PAPER_TIMEOUT_CANDLES,
  resolvePaperTrade,
  type PaperTrade,
} from "./resolve";

const START = Date.parse("2026-11-04T00:00:00.000Z");
const M15 = 15 * 60_000;

/** Candles from [open, high, low, close] rows, starting after the entry candle. */
function candles(rows: ReadonlyArray<readonly [number, number, number, number]>): Candle[] {
  return rows.map(([open, high, low, close], i) => ({
    time: new Date(START + i * M15).toISOString(),
    open,
    high,
    low,
    close,
  }));
}
const closeOf = (i: number) => new Date(START + (i + 1) * M15).toISOString();

// EUR_USD SELL: 20-pip stop, 60-pip target, $50 risk.
const SELL: PaperTrade = {
  pair: "EUR_USD",
  direction: "SELL",
  entry: 1.1,
  stop: 1.102,
  target: 1.094,
  riskUsd: 50,
  openedAt: "2026-11-04T00:00:00.000Z",
};
// EUR_USD BUY mirror.
const BUY: PaperTrade = { ...SELL, direction: "BUY", stop: 1.098, target: 1.106 };

const QUIET = [1.1, 1.1005, 1.0995, 1.1] as const;

describe("resolvePaperTrade — SELL", () => {
  it("target first → WIN at the target, +3R", () => {
    const result = resolvePaperTrade(SELL, candles([QUIET, [1.099, 1.0995, 1.0938, 1.095]]));
    expect(result).toEqual({
      status: "WIN",
      exitPrice: 1.094,
      closedAt: closeOf(1),
      resultR: 3,
      pnlUsd: 150,
    });
  });

  it("stop first → LOSS at the stop, −1R", () => {
    const result = resolvePaperTrade(SELL, candles([QUIET, [1.1005, 1.1021, 1.1, 1.101], [1.1, 1.1, 1.09, 1.09]]));
    expect(result).toEqual({
      status: "LOSS",
      exitPrice: 1.102,
      closedAt: closeOf(1),
      resultR: -1,
      pnlUsd: -50,
    });
  });

  it("touching the stop exactly counts as hit", () => {
    expect(resolvePaperTrade(SELL, candles([[1.1, 1.102, 1.0995, 1.1]])).status).toBe("LOSS");
  });

  it("stop and target in the same candle → LOSS with a note", () => {
    const result = resolvePaperTrade(SELL, candles([[1.1, 1.1025, 1.093, 1.095]]));
    expect(result).toMatchObject({ status: "LOSS", exitPrice: 1.102, resultR: -1, note: NOTE_SAME_CANDLE });
  });

  it("gap through the stop → LOSS at the open, worse than −1R", () => {
    const result = resolvePaperTrade(SELL, candles([QUIET, [1.103, 1.1035, 1.1025, 1.103]]));
    expect(result).toEqual({
      status: "LOSS",
      exitPrice: 1.103,
      closedAt: closeOf(1),
      resultR: -1.5, // 30 pips against a 20-pip stop
      pnlUsd: -75,
      note: NOTE_GAPPED_STOP,
    });
  });

  it("gap through the target → WIN at the target, no bonus", () => {
    const result = resolvePaperTrade(SELL, candles([[1.09, 1.091, 1.089, 1.09]]));
    expect(result).toMatchObject({ status: "WIN", exitPrice: 1.094, resultR: 3, pnlUsd: 150, note: NOTE_GAPPED_TARGET });
  });

  it("still open while neither level is hit", () => {
    expect(resolvePaperTrade(SELL, candles([QUIET, QUIET]))).toEqual({ status: "OPEN" });
    expect(resolvePaperTrade(SELL, [])).toEqual({ status: "OPEN" });
  });
});

describe("resolvePaperTrade — BUY", () => {
  it("target first → WIN", () => {
    expect(resolvePaperTrade(BUY, candles([QUIET, [1.101, 1.1062, 1.1005, 1.105]]))).toMatchObject({
      status: "WIN",
      exitPrice: 1.106,
      resultR: 3,
      pnlUsd: 150,
    });
  });
  it("stop first → LOSS", () => {
    expect(resolvePaperTrade(BUY, candles([[1.1, 1.1005, 1.0979, 1.099]]))).toMatchObject({
      status: "LOSS",
      exitPrice: 1.098,
      resultR: -1,
    });
  });
  it("both in one candle → LOSS", () => {
    expect(resolvePaperTrade(BUY, candles([[1.1, 1.107, 1.097, 1.1]]))).toMatchObject({
      status: "LOSS",
      note: NOTE_SAME_CANDLE,
    });
  });
  it("gap down through the stop → LOSS at the open", () => {
    expect(resolvePaperTrade(BUY, candles([[1.0975, 1.098, 1.097, 1.0975]]))).toMatchObject({
      status: "LOSS",
      exitPrice: 1.0975,
      resultR: -1.25,
      pnlUsd: -62.5,
      note: NOTE_GAPPED_STOP,
    });
  });
});

describe("resolvePaperTrade — timeout", () => {
  it("UNRESOLVED after the timeout, exit at the last close with its R", () => {
    const rows = Array.from({ length: 5 }, () => [1.1, 1.1005, 1.0995, 1.099] as const);
    const result = resolvePaperTrade(SELL, candles(rows), 5);
    expect(result).toEqual({
      status: "UNRESOLVED",
      exitPrice: 1.099,
      closedAt: closeOf(4),
      resultR: 0.5, // 10 pips in favour / 20-pip stop
      pnlUsd: 25,
      note: "no result within the timeout",
    });
  });

  it("is OPEN one candle before the timeout", () => {
    const rows = Array.from({ length: 4 }, () => QUIET);
    expect(resolvePaperTrade(SELL, candles(rows), 5)).toEqual({ status: "OPEN" });
  });

  it("ignores candles after the timeout", () => {
    const rows = [...Array.from({ length: 5 }, () => QUIET), [1.09, 1.09, 1.08, 1.08] as const];
    expect(resolvePaperTrade(SELL, candles(rows), 5).status).toBe("UNRESOLVED");
  });

  it("defaults to 288 candles (72 h of market time)", () => {
    expect(PAPER_TIMEOUT_CANDLES).toBe(288);
    const rows = Array.from({ length: 288 }, () => QUIET);
    expect(resolvePaperTrade(SELL, candles(rows)).status).toBe("UNRESOLVED");
    expect(resolvePaperTrade(SELL, candles(rows.slice(1))).status).toBe("OPEN");
  });
});

describe("resolvePaperTrade — USD_JPY and R maths", () => {
  // BUY 157.250, stop 156.850 (40 pips), target 158.450 (120 pips), $50 risk.
  const JPY: PaperTrade = {
    pair: "USD_JPY",
    direction: "BUY",
    entry: 157.25,
    stop: 156.85,
    target: 158.45,
    riskUsd: 50,
    openedAt: "2026-11-04T00:45:00.000Z",
  };
  it("WIN is +3R and +$150", () => {
    expect(resolvePaperTrade(JPY, candles([[157.3, 158.5, 157.2, 158.4]]))).toMatchObject({
      status: "WIN",
      exitPrice: 158.45,
      resultR: 3,
      pnlUsd: 150,
    });
  });
  it("LOSS is −1R and −$50", () => {
    expect(resolvePaperTrade(JPY, candles([[157.2, 157.3, 156.8, 156.9]]))).toMatchObject({
      status: "LOSS",
      exitPrice: 156.85,
      resultR: -1,
      pnlUsd: -50,
    });
  });
  it("partial move R at timeout uses JPY prices", () => {
    expect(resolvePaperTrade(JPY, candles([[157.3, 157.5, 157.2, 157.45]]), 1)).toMatchObject({
      status: "UNRESOLVED",
      resultR: 0.5, // +20 pips / 40
      pnlUsd: 25,
    });
  });
  it("rejects a trade with no stop distance", () => {
    expect(() => resolvePaperTrade({ ...JPY, stop: JPY.entry }, [])).toThrow(RangeError);
  });
});
