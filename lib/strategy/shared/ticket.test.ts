import { describe, expect, it } from "vitest";
import { SETTINGS } from "../__fixtures__/candles";
import { buildTradeTicket, pipValuePerLotUsd } from "./ticket";

describe("pipValuePerLotUsd", () => {
  it("is $10 for XXX/USD pairs and gold", () => {
    expect(pipValuePerLotUsd("EUR_USD", 1.1)).toBe(10);
    expect(pipValuePerLotUsd("GBP_USD", 1.3)).toBe(10);
    expect(pipValuePerLotUsd("XAU_USD", 2650)).toBe(10);
  });
  it("is 10 ÷ price for USD/CAD and USD/CHF, 1000 ÷ price for USD/JPY", () => {
    expect(pipValuePerLotUsd("USD_CAD", 1.25)).toBe(8);
    expect(pipValuePerLotUsd("USD_CHF", 0.8)).toBe(12.5);
    expect(pipValuePerLotUsd("USD_JPY", 125)).toBe(8);
  });
});

describe("buildTradeTicket", () => {
  it("7a. EUR_USD 19-pip stop at $10,000 / 0.5% → 0.26 lots", () => {
    const result = buildTradeTicket({
      pair: "EUR_USD",
      direction: "SELL",
      entry: 1.1,
      sweepExtreme: 1.1016, // + 3 pips buffer = 1.10190, 19 pips
      settings: SETTINGS,
    });
    expect(result).toEqual({
      ok: true,
      ticket: {
        entry: 1.1,
        stop: 1.1019,
        target: 1.0943, // 57 pips below
        stopPips: 19,
        targetPips: 57,
        riskPct: 0.5,
        riskUsd: 50,
        lotSize: 0.26, // $50 ÷ $190 = 0.263
      },
    });
  });

  it("7b. USD_CAD BUY: pip value 10 ÷ entry, lot rounded down without float error", () => {
    const result = buildTradeTicket({
      pair: "USD_CAD",
      direction: "BUY",
      entry: 1.4,
      sweepExtreme: 1.3983, // − 3 pips = 1.39800, 20 pips
      settings: SETTINGS,
    });
    expect(result).toEqual({
      ok: true,
      ticket: {
        entry: 1.4,
        stop: 1.398,
        target: 1.406, // 60 pips above
        stopPips: 20,
        targetPips: 60,
        riskPct: 0.5,
        riskUsd: 50,
        lotSize: 0.35, // $50 ÷ (20 × 10/1.4 = $142.86) = exactly 0.35
      },
    });
  });

  it("rounds down, never up", () => {
    const result = buildTradeTicket({
      pair: "EUR_USD",
      direction: "BUY",
      entry: 1.1,
      sweepExtreme: 1.09983, // − 3 pips = 1.09953, 4.7 pips
      settings: SETTINGS,
    });
    // $50 ÷ $47 = 1.0638 → 1.06
    expect(result.ok && result.ticket.lotSize).toBe(1.06);
    expect(result.ok && result.ticket.stopPips).toBe(4.7);
  });

  it("uses the reward ratio and 1% risk from settings", () => {
    const result = buildTradeTicket({
      pair: "GBP_USD",
      direction: "SELL",
      entry: 1.3,
      sweepExtreme: 1.3017, // 20 pips
      settings: { ...SETTINGS, riskPct: 1, rewardRatio: 2 },
    });
    expect(result.ok && result.ticket).toMatchObject({
      target: 1.296,
      targetPips: 40,
      riskUsd: 100,
      lotSize: 0.5,
    });
  });

  it("rounds prices to the pair's decimals (JPY 3, gold 2)", () => {
    const jpy = buildTradeTicket({ pair: "USD_JPY", direction: "BUY", entry: 157.2504, sweepExtreme: 156.8801, settings: SETTINGS });
    expect(jpy.ok && [jpy.ticket.entry, jpy.ticket.stop]).toEqual([157.25, 156.85]);
    const gold = buildTradeTicket({ pair: "XAU_USD", direction: "SELL", entry: 2650.123, sweepExtreme: 2655.5, settings: SETTINGS });
    expect(gold.ok && gold.ticket).toMatchObject({ entry: 2650.12, stop: 2655.8, stopPips: 56.8 });
  });

  it("8. lot size below 0.01 → not ok, with a reason", () => {
    const result = buildTradeTicket({
      pair: "EUR_USD",
      direction: "SELL",
      entry: 1.1,
      sweepExtreme: 1.1016,
      settings: { ...SETTINGS, accountSizeUsd: 100 },
    });
    expect(result).toEqual({ ok: false, reason: "Lot size below 0.01: $0.5 risk over a 19-pip stop" });
  });

  it("refuses a stop that is not beyond the entry", () => {
    const result = buildTradeTicket({
      pair: "EUR_USD",
      direction: "SELL",
      entry: 1.11,
      sweepExtreme: 1.1,
      settings: SETTINGS,
    });
    expect(result.ok).toBe(false);
  });
});
