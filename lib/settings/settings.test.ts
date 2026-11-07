import { describe, expect, it } from "vitest";
import { DEFAULTS } from "./__fixtures__/defaults";
import { diff, snapshot, snapshotJson, validate, type SettingsSnapshot, type SettingsValues } from "./index";



const base = (): SettingsSnapshot =>
  snapshot(
    DEFAULTS,
    [
      { pair: "EUR_USD", enabled: true, sortOrder: 1 },
      { pair: "XAU_USD", enabled: false, sortOrder: 6 },
    ],
    [
      { strategyId: "dg-v1", mode: "LIVE" },
      { strategyId: "gemini-fvg", mode: "TEST" },
    ],
  );

describe("snapshot", () => {
  it("gives the same JSON for the same input, whatever the order", () => {
    const a = base();
    const b = snapshot(
      { ...DEFAULTS, ...({ extra: 1 } as object) } as SettingsValues,
      [...a.watchlist].reverse(),
      [...a.strategies].reverse(),
    );
    expect(snapshotJson(b)).toBe(snapshotJson(a));
    expect(Object.keys(a.settings)[0]).toBe("accountSizeUsd");
    expect(a.strategies.map((s) => s.strategyId)).toEqual(["dg-v1", "gemini-fvg"]);
    expect(JSON.stringify(b)).not.toContain("extra");
  });
});

describe("diff", () => {
  it("uses labels and formats values", () => {
    const a = base();
    const b: SettingsSnapshot = {
      settings: { ...a.settings, riskPct: 1, accountSizeUsd: 25_000, warnDailyLossPct: 1, paperTimeoutHours: 48, pushEnabled: false, stopBufferPips: 2.5 },
      watchlist: a.watchlist.map((w) => (w.pair === "XAU_USD" ? { ...w, enabled: true } : w)),
      strategies: a.strategies.map((s) => (s.strategyId === "gemini-fvg" ? { ...s, mode: "LIVE" } : s)),
    };
    expect(diff(a, b, (id) => (id === "gemini-fvg" ? "FVG Retest" : id))).toEqual([
      { field: "Account size", from: "$10,000", to: "$25,000" },
      { field: "Risk per trade", from: "0.5%", to: "1%" },
      { field: "Warn me at (today)", from: "−1.5%", to: "−1%" },
      { field: "Stop buffer", from: "3 pips", to: "2.5 pips" },
      { field: "Paper trade time limit", from: "72 h", to: "48 h" },
      { field: "App alerts (push)", from: "on", to: "off" },
      { field: "Gold (XAU/USD)", from: "off", to: "on" },
      { field: "FVG Retest", from: "Test", to: "Live" },
    ]);
  });

  it("no changes → empty list", () => {
    expect(diff(base(), base())).toEqual([]);
  });
});

describe("validate", () => {
  const withSettings = (over: Partial<SettingsValues>) => ({ ...base(), settings: { ...DEFAULTS, ...over } });
  const errorsOf = (input: unknown) => {
    const r = validate(input);
    return r.ok ? [] : r.errors;
  };

  it("accepts the defaults", () => {
    expect(validate(base())).toMatchObject({ ok: true });
  });

  it.each([
    ["risk below 0.1%", { riskPct: 0.05 }, "settings.riskPct"],
    ["risk above 2%", { riskPct: 2.5 }, "settings.riskPct"],
    ["account size 0", { accountSizeUsd: 0 }, "settings.accountSizeUsd"],
    ["daily limit not below overall", { dailyLossLimitPct: 10, maxDrawdownPct: 10 }, "settings.dailyLossLimitPct"],
    ["daily warning at the limit", { warnDailyLossPct: 3 }, "settings.warnDailyLossPct"],
    ["stop for the day above the limit", { stopDailyLossPct: 3.5 }, "settings.stopDailyLossPct"],
    ["warning after done-for-the-day", { warnDailyLossPct: 2.5 }, "settings.warnDailyLossPct"],
    ["overall warning at the max drawdown", { warnOverallLossPct: 10 }, "settings.warnOverallLossPct"],
    ["paper time limit under 24 h", { paperTimeoutHours: 12 }, "settings.paperTimeoutHours"],
    ["paper time limit over 168 h", { paperTimeoutHours: 200 }, "settings.paperTimeoutHours"],
    ["expiry not a multiple of 15", { watchExpiryMinutes: 100 }, "settings.watchExpiryMinutes"],
    ["swing strength 0", { swingStrength: 0 }, "settings.swingStrength"],
    ["stop buffer 50 pips", { stopBufferPips: 50 }, "settings.stopBufferPips"],
    ["max trades 1.5", { maxTradesPerDay: 1.5 }, "settings.maxTradesPerDay"],
  ])("rejects %s", (_name, over, path) => {
    expect(errorsOf(withSettings(over)).map((e) => e.path)).toContain(path);
  });

  it("needs at least one LIVE strategy (several are fine)", () => {
    const noLive = { ...base(), strategies: [{ strategyId: "dg-v1", mode: "TEST" }] };
    expect(errorsOf(noLive)).toEqual([{ path: "strategies", message: "At least one strategy must stay Live." }]);
    const twoLive = { ...base(), strategies: [{ strategyId: "dg-v1", mode: "LIVE" }, { strategyId: "gemini-fvg", mode: "LIVE" }] };
    expect(validate(twoLive).ok).toBe(true);
  });

  it("needs at least one enabled pair", () => {
    const none = { ...base(), watchlist: base().watchlist.map((w) => ({ ...w, enabled: false })) };
    expect(errorsOf(none)).toEqual([{ path: "watchlist", message: "Keep at least one pair on" }]);
  });

  it("rejects wrong types and unknown pairs", () => {
    expect(validate({ ...base(), settings: { ...DEFAULTS, riskPct: "1" } }).ok).toBe(false);
    expect(validate({ ...base(), watchlist: [{ pair: "BTC_USD", enabled: true, sortOrder: 1 }] }).ok).toBe(false);
  });
});
