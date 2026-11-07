import { describe, expect, it } from "vitest";
import type { Direction, Pair } from "@/lib/types";
import { computeRiskGuard, propDayStart, resultToPnl, usdExposure, usdSide, wouldBreachDaily, type RiskEntry, type RiskSettings } from "./index";

const SETTINGS: RiskSettings = {
  accountSizeUsd: 10_000,
  dailyLossLimitPct: 3,
  maxDrawdownPct: 10,
  warnDailyLossPct: 1.5,
  stopDailyLossPct: 2,
  warnOverallLossPct: 5,
  maxTradesPerDay: 2,
  dayResetTz: "America/New_York",
  dayResetHour: 17,
  drawdownType: "STATIC",
};

// Wed 4 Nov 2026 15:00 UTC: the prop day started Tue 3 Nov 17:00 New York = 22:00 UTC.
const NOW = new Date("2026-11-04T15:00:00.000Z");
const TODAY = "2026-11-04T10:00:00.000Z";
const YESTERDAY = "2026-11-03T15:00:00.000Z";

function closed(pnlUsd: number, closedAt = TODAY, opts: Partial<RiskEntry> = {}): RiskEntry {
  return { pair: "EUR_USD", direction: "SELL", status: "CLOSED", openedAt: closedAt, closedAt, pnlUsd, riskUsd: 50, ...opts };
}
function open(riskUsd = 50, pair: Pair = "EUR_USD", direction: Direction = "SELL", openedAt = YESTERDAY): RiskEntry {
  return { pair, direction, status: "OPEN", openedAt, closedAt: null, pnlUsd: null, riskUsd };
}
const guard = (entries: RiskEntry[], settings: Partial<RiskSettings> = {}, now = NOW) => computeRiskGuard({ ...SETTINGS, ...settings }, entries, now);

describe("states at the Settings levels", () => {
  it("no entries → cleared", () => {
    expect(guard([])).toMatchObject({ state: "cleared", title: "Cleared to trade", todayPct: 0, overallPct: 0, openRiskUsd: 0, tradesToday: 0, reasons: [] });
  });

  it.each([
    [-149, "cleared"],
    [-150, "warning"], // −1.5%
    [-199, "warning"],
    [-200, "stopped"], // −2%
    [-299, "stopped"],
    [-300, "breached"], // −3%
  ] as const)("today %s USD → %s", (pnl, state) => {
    // A closed entry opened yesterday so it doesn't count as a trade today.
    expect(guard([closed(pnl, TODAY, { openedAt: YESTERDAY })]).state).toBe(state);
  });

  it("uses the levels from Settings, not built-in numbers", () => {
    const e = [closed(-150, TODAY, { openedAt: YESTERDAY })];
    expect(guard(e, { warnDailyLossPct: 1, stopDailyLossPct: 1.4, dailyLossLimitPct: 5 }).state).toBe("stopped");
    expect(guard(e, { warnDailyLossPct: 2, stopDailyLossPct: 2.5, dailyLossLimitPct: 4 }).state).toBe("cleared");
  });

  it("overall: warning at −5%, breached at −10% (static: against the account size)", () => {
    expect(guard([closed(-499, YESTERDAY)]).state).toBe("cleared");
    expect(guard([closed(-500, YESTERDAY)])).toMatchObject({ state: "warning", overallPct: -5 });
    expect(guard([closed(-1000, YESTERDAY)])).toMatchObject({ state: "breached", overallPct: -10, title: "Prop limit reached" });
  });

  it("today is measured against the balance at the start of the prop day", () => {
    // +1,000 before today → day starts at $11,000; −165 = −1.5% of that.
    const v = guard([closed(1000, YESTERDAY), closed(-165, TODAY, { openedAt: YESTERDAY })]);
    expect(v).toMatchObject({ startOfDayBalanceUsd: 11_000, todayPnlUsd: -165, todayPct: -1.5, state: "warning" });
    expect(v.reasons).toContain("You're down 1.5% today. Your warning level is 1.5%.");
  });

  it("trades today at the maximum → warning", () => {
    const v = guard([closed(0, TODAY), closed(0, TODAY)]);
    expect(v).toMatchObject({ tradesToday: 2, state: "warning" });
    expect(v.reasons).toContain("2 trades today. Your maximum is 2.");
    expect(guard([closed(0, TODAY)]).state).toBe("cleared");
  });

  it("worst case today reaching the stop level → warning; a stopped day says so instead", () => {
    expect(guard([open(150)])).toMatchObject({ openRiskUsd: 150, worstCaseTodayPct: -1.5, state: "cleared" });
    const v = guard([open(120), open(80, "USD_JPY", "SELL")]);
    expect(v).toMatchObject({ openRiskUsd: 200, worstCaseTodayPct: -2, state: "warning" });
    expect(v.reasons).toContain("If every open stop is hit you'd be down 2% today, past your 2% stop.");
  });
});

describe("open risk and USD exposure", () => {
  it("open risk is the sum of the open entries' risk", () => {
    expect(guard([open(50), open(75, "GBP_USD", "BUY"), closed(-50, TODAY, { openedAt: YESTERDAY })]).openRiskUsd).toBe(125);
  });

  it("which side of the dollar each trade is on", () => {
    expect(usdSide("EUR_USD", "BUY")).toBe("short");
    expect(usdSide("EUR_USD", "SELL")).toBe("long");
    expect(usdSide("USD_JPY", "BUY")).toBe("long");
    expect(usdSide("USD_CHF", "SELL")).toBe("short");
  });

  it("warns at 2+ trades in the same USD direction", () => {
    expect(usdExposure([{ pair: "EUR_USD", direction: "BUY" }, { pair: "GBP_USD", direction: "BUY" }, { pair: "USD_CHF", direction: "SELL" }])).toEqual({
      long: 0,
      short: 3,
      text: "3 open trades all short USD",
      warn: true,
    });
    expect(usdExposure([{ pair: "EUR_USD", direction: "BUY" }, { pair: "USD_JPY", direction: "BUY" }])).toMatchObject({
      text: "1 long USD · 1 short USD",
      warn: false,
    });
    expect(usdExposure([])).toMatchObject({ text: "No open trades", warn: false });
    const v = guard([open(10, "EUR_USD", "SELL"), open(10, "USD_JPY", "BUY")]);
    expect(v.state).toBe("warning");
    expect(v.reasons).toContain("2 open trades all long USD: they win or lose together.");
  });
});

describe("drawdown type", () => {
  const history = [closed(500, "2026-11-02T10:00:00.000Z"), closed(-400, YESTERDAY)];
  it("STATIC: from the account size", () => {
    expect(guard(history)).toMatchObject({ overallPct: 1, drawdownBaseUsd: 10_000 });
  });
  it("TRAILING: from the highest closed balance so far", () => {
    // Peak $10,500, now $10,100 → −3.81%.
    expect(guard(history, { drawdownType: "TRAILING" })).toMatchObject({ overallPct: -3.81, drawdownBaseUsd: 10_500 });
    // −5.2% from the peak → warning, while STATIC would still be fine.
    const deeper = [closed(1000, "2026-11-02T10:00:00.000Z"), closed(-572, YESTERDAY)];
    expect(guard(deeper, { drawdownType: "TRAILING" }).state).toBe("warning");
    expect(guard(deeper).state).toBe("cleared");
  });
});

describe("prop day reset (17:00 New York) across the DST change", () => {
  it("day start in summer (EDT, 21:00 UTC) and winter (EST, 22:00 UTC)", () => {
    expect(propDayStart(new Date("2026-10-30T18:00:00Z"), "America/New_York", 17).toISOString()).toBe("2026-10-29T21:00:00.000Z");
    expect(propDayStart(new Date("2026-10-30T21:00:00Z"), "America/New_York", 17).toISOString()).toBe("2026-10-30T21:00:00.000Z");
    // Clocks go back on Sun 1 Nov 2026.
    expect(propDayStart(new Date("2026-11-02T21:30:00Z"), "America/New_York", 17).toISOString()).toBe("2026-11-01T22:00:00.000Z");
    expect(propDayStart(new Date("2026-11-02T22:00:00Z"), "America/New_York", 17).toISOString()).toBe("2026-11-02T22:00:00.000Z");
    // Other zones and hours.
    expect(propDayStart(new Date("2026-11-04T10:00:00Z"), "UTC", 0).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(propDayStart(new Date("2026-07-15T10:00:00Z"), "Europe/London", 0).toISOString()).toBe("2026-07-14T23:00:00.000Z");
  });

  it("a loss closed just before the reset counts for the previous day", () => {
    const now = new Date("2026-11-02T23:00:00Z"); // Mon 18:00 EST
    expect(computeRiskGuard(SETTINGS, [closed(-200, "2026-11-02T21:59:00Z", { openedAt: "2026-11-02T20:00:00Z" })], now)).toMatchObject({
      todayPnlUsd: 0,
      state: "cleared",
    });
    expect(computeRiskGuard(SETTINGS, [closed(-200, "2026-11-02T22:01:00Z", { openedAt: "2026-11-02T20:00:00Z" })], now)).toMatchObject({
      todayPnlUsd: -200,
      state: "stopped",
    });
  });
});

describe("only DG's own entries", () => {
  it("deleted entries never count", () => {
    const v = guard([closed(-300, TODAY, { openedAt: YESTERDAY, deletedAt: TODAY }), { ...open(500), deletedAt: TODAY }]);
    expect(v).toMatchObject({ state: "cleared", todayPnlUsd: 0, openRiskUsd: 0, tradesToday: 0 });
  });

  it("wouldBreachDaily: taking one more trade would push the worst case past the daily limit", () => {
    const v = guard([closed(-200, TODAY, { openedAt: YESTERDAY })]);
    expect(wouldBreachDaily(v, 99)).toBe(false);
    expect(wouldBreachDaily(v, 100)).toBe(true);
  });
});

describe("result → money", () => {
  it("win = risk × R (default 3, editable); loss = −risk; break-even 0; custom = the USD entered", () => {
    expect(resultToPnl("WIN", 50)).toEqual({ pnlUsd: 150, resultR: 3 });
    expect(resultToPnl("WIN", 50, { r: 2.5 })).toEqual({ pnlUsd: 125, resultR: 2.5 });
    expect(resultToPnl("LOSS", 50)).toEqual({ pnlUsd: -50, resultR: -1 });
    expect(resultToPnl("BREAKEVEN", 50)).toEqual({ pnlUsd: 0, resultR: 0 });
    expect(resultToPnl("CUSTOM", 50, { usd: -53.5 })).toEqual({ pnlUsd: -53.5, resultR: -1.07 });
  });
  it("rejects a custom result without USD, or no risk", () => {
    expect(() => resultToPnl("CUSTOM", 50)).toThrow(RangeError);
    expect(() => resultToPnl("WIN", 0)).toThrow(RangeError);
    expect(() => resultToPnl("WIN", 50, { r: -1 })).toThrow(RangeError);
  });
});
