import { describe, expect, it } from "vitest";
import { buildAlertSummary, type SummaryInput } from "./index";

const BASE: SummaryInput = {
  pair: "EUR_USD",
  direction: "SELL",
  status: "READY",
  time: "2026-11-04T09:42:00.000Z",
  strategy: { name: "DG v1 · Original", mode: "LIVE" },
  alsoSeenBy: [
    { name: "DG v2 · Strong liquidity", mode: "TEST" },
    { name: "Pro Sweep", mode: "LIVE" },
  ],
  sweepLabel: "previous day high",
  sweepLevel: 1.107,
  confirmation: "15m body closed below 1.10150",
  ticket: {
    entry: 1.101,
    stop: 1.1081,
    target: 1.0797,
    stopPips: 71,
    targetPips: 213,
    rewardRatio: 3,
    riskPct: 0.5,
    riskUsd: 50,
    lotSize: 0.07,
    entryType: "MARKET",
    entryValidUntil: null,
  },
  paper: { status: "OPEN", resultR: null, pnlUsd: null },
  accountSizeUsd: 10_000,
  riskGuard: "no trades logged yet",
  rules: ["Daily and 4H trend must agree.", "Fixed 1:3."],
};

describe("buildAlertSummary", () => {
  it("includes pair, direction, status, time, strategies and seen-by", () => {
    const text = buildAlertSummary(BASE);
    expect(text).toContain(
      "Pair: EUR/USD | Direction: SELL | Status: READY | Strategies: DG v1 · Original (live); also seen by DG v2 · Strong liquidity (test), Pro Sweep (live)",
    );
    expect(text).toContain("Time: Wed 4 Nov · 10:42 Lagos");
  });

  it("includes the levels, the ticket, the risk and the paper status", () => {
    const text = buildAlertSummary(BASE);
    expect(text).toContain("Liquidity swept: previous day high at 1.10700");
    expect(text).toContain("Confirmation: 15m body closed below 1.10150");
    expect(text).toContain("Entry 1.10100 | Stop 1.10810 (71 pips) | Target 1.07970 (213 pips) | 1:3");
    expect(text).toContain("Risk: 0.5% of $10,000 = $50 | Lot size: 0.07");
    expect(text).toContain("Paper trade: open (tracking to target or stop)");
    expect(text).toContain("Risk guard: no trades logged yet");
    expect(text).toContain("My rules (DG v1 · Original): Daily and 4H trend must agree. Fixed 1:3.");
    expect(text).toContain("I know you can't predict whether it wins.");
  });

  it("formats JPY prices with 3 decimals", () => {
    const text = buildAlertSummary({
      ...BASE,
      pair: "USD_JPY",
      direction: "BUY",
      sweepLevel: 156.3,
      ticket: { ...BASE.ticket!, entry: 156.78, stop: 156.22, target: 158.46, stopPips: 56, targetPips: 168 },
    });
    expect(text).toContain("Pair: USD/JPY | Direction: BUY");
    expect(text).toContain("Liquidity swept: previous day high at 156.300");
    expect(text).toContain("Entry 156.780 | Stop 156.220 (56 pips) | Target 158.460 (168 pips)");
  });

  it("limit entries, decided paper results and Watching alerts", () => {
    const limit = buildAlertSummary({
      ...BASE,
      ticket: { ...BASE.ticket!, entryType: "LIMIT", entryValidUntil: "2026-11-04T13:42:00.000Z" },
      paper: { status: "WIN", resultR: 3, pnlUsd: 150 },
    });
    expect(limit).toContain("Limit entry 1.10100 (valid until Wed 4 Nov · 14:42 Lagos)");
    expect(limit).toContain("Paper trade: win +3R · +$150");
    expect(buildAlertSummary({ ...BASE, paper: { status: "NOT_FILLED", resultR: 0, pnlUsd: 0 } })).toContain(
      "Paper trade: limit entry not filled (0R)",
    );
    const watching = buildAlertSummary({ ...BASE, status: "WATCHING", ticket: null, paper: null, alsoSeenBy: [] });
    expect(watching).toContain("Trade ticket: not ready yet (still watching)");
    expect(watching).toContain("Paper trade: none (alert not Ready)");
    expect(watching).toContain("Strategies: DG v1 · Original (live) |".replace(" |", ""));
  });
});
