import { describe, expect, it } from "vitest";
import type { PaperResult } from "@/lib/paper/resolve";
import type { SetupRecord, TradeRecord } from "./engine";
import { summarize } from "./stats";

const setup = (status: SetupRecord["status"]): SetupRecord => ({
  dedupeKey: Math.random().toString(),
  pair: "EUR_USD",
  direction: "SELL",
  sweepType: "PDH",
  sweepLevel: 1.1,
  sweepTime: "2026-01-01T00:00:00.000Z",
  sweepExtreme: 1.101,
  bosLevel: 1.099,
  status,
});

function trade(result: PaperResult): TradeRecord {
  return {
    setup: setup("CONFIRMED"),
    ticket: { entry: 1, stop: 1, target: 1, stopPips: 1, targetPips: 3, riskPct: 0.5, riskUsd: 50, lotSize: 0.1 },
    trade: { pair: "EUR_USD", direction: "SELL", entry: 1, stop: 1, target: 1, riskUsd: 50, openedAt: "" },
    result,
  };
}
const win = (closedAt: string) => trade({ status: "WIN", closedAt, resultR: 3, pnlUsd: 150 });
const loss = (closedAt: string, note?: string) =>
  trade({ status: "LOSS", closedAt, resultR: -1, pnlUsd: -50, ...(note ? { note } : {}) });

describe("summarize", () => {
  const trades = [
    win("2026-01-05T10:00:00.000Z"),
    loss("2026-01-06T10:00:00.000Z"),
    loss("2026-01-07T10:00:00.000Z", "stop and target in same candle"),
    loss("2026-02-02T10:00:00.000Z", "gapped through stop"),
    trade({ status: "UNRESOLVED", closedAt: "2026-02-03T10:00:00.000Z", resultR: 0.5, pnlUsd: 25 }),
    loss("2026-02-04T10:00:00.000Z"),
    win("2026-02-05T10:00:00.000Z"),
    trade({ status: "OPEN" }),
  ];
  const setups = [setup("CONFIRMED"), setup("EXPIRED"), setup("EXPIRED"), setup("INVALID"), setup("WATCHING")];
  const s = summarize(setups, trades);

  it("counts setups and trades", () => {
    expect(s).toMatchObject({
      setups: 5,
      confirmed: 1,
      expired: 2,
      invalid: 1,
      watchingAtEnd: 1,
      trades: 8,
      wins: 2,
      losses: 4,
      unresolved: 1,
      open: 1,
      sameCandleLosses: 1,
      gappedLosses: 1,
    });
  });

  it("computes win rate over decided trades and R over closed trades", () => {
    expect(s.winRate).toBeCloseTo(2 / 6);
    expect(s.netR).toBe(2.5); // 3 −1 −1 −1 +0.5 −1 +3
    expect(s.netUsd).toBe(125);
    expect(s.avgR).toBe(0.36); // 2.5 / 7
  });

  it("finds the worst losing streak (an unresolved trade breaks it)", () => {
    expect(s.worstLosingStreak).toBe(3); // 6 Jan, 7 Jan, 2 Feb
  });

  it("measures max drawdown from the running peak", () => {
    // Curve: 3, 2, 1, 0, 0.5, -0.5, 2.5 → peak 3, trough -0.5
    expect(s.maxDrawdownR).toBe(3.5);
    expect(s.maxDrawdownUsd).toBe(175);
  });

  it("builds the monthly table and best/worst month", () => {
    expect(s.months).toEqual([
      { month: "2026-01", trades: 3, wins: 1, losses: 2, netR: 1 },
      { month: "2026-02", trades: 4, wins: 1, losses: 2, netR: 1.5 },
    ]);
    expect(s.bestMonth?.month).toBe("2026-02");
    expect(s.worstMonth?.month).toBe("2026-01");
  });

  it("handles no trades", () => {
    const empty = summarize([], []);
    expect(empty).toMatchObject({ winRate: null, avgR: null, netR: 0, maxDrawdownR: 0, bestMonth: null });
  });
});
