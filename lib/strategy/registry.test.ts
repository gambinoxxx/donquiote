import { describe, expect, it } from "vitest";
import { applyEvents } from "./apply-events";
import { activeStrategies, assertSomeLive } from "./modes";
import { findStrategy, getStrategy, getStrategyInfo, listStrategies, listStrategyInfo } from "./registry";
import type { OpenSetup } from "./types";

describe("registry", () => {
  it("registers the six strategies, dg-v1 first", () => {
    expect(listStrategies().map((s) => s.id)).toEqual([
      "dg-v1",
      "dg-v2-candidate",
      "gemini-fvg",
      "pro-v1-swing",
      "gemini-fvg-2r",
      "london-break",
    ]);
    expect(getStrategy("dg-v1").name).toBe("DG v1 · sweep + 15m BOS"); // dg-v1 itself is unchanged
  });

  it("gives each one an app name, a unique code, a description and rules", () => {
    const infos = listStrategyInfo();
    expect(infos.map((i) => [i.id, i.name, i.code])).toEqual([
      ["dg-v1", "DG v1 · Original", "V1"],
      ["dg-v2-candidate", "DG v2 · Strong liquidity", "V2"],
      ["gemini-fvg", "FVG Retest", "FVG"],
      ["pro-v1-swing", "Pro Sweep", "PRO"],
      ["gemini-fvg-2r", "FVG Retest · 1:2", "FVG2"],
      ["london-break", "London Breakout", "LDN"],
    ]);
    expect(new Set(infos.map((i) => i.code)).size).toBe(infos.length);
    expect(new Set(infos.map((i) => i.id)).size).toBe(infos.length);
    for (const info of infos) {
      expect(info.strategy.id).toBe(info.id);
      expect(info.description.length).toBeGreaterThan(0);
      expect(info.rules.length).toBeGreaterThan(0);
      expect(typeof info.strategy.evaluate).toBe("function");
    }
    expect(getStrategyInfo("gemini-fvg").code).toBe("FVG");
  });

  it("reward ratios and time exits: 3R by default, FVG2 2R, LDN 1.5R out at 16:00 UTC", () => {
    expect(getStrategy("dg-v1").rewardRatio).toBeUndefined(); // from Settings (3)
    expect(getStrategy("gemini-fvg").rewardRatio).toBe(3);
    expect(getStrategy("gemini-fvg-2r").rewardRatio).toBe(2);
    expect(getStrategy("london-break").rewardRatio).toBe(1.5);
    expect(getStrategy("london-break").exitAtUtcHour).toBe(16);
    expect(listStrategies().filter((s) => s.exitAtUtcHour !== undefined).map((s) => s.id)).toEqual(["london-break"]);
    expect(findStrategy("nope")).toBeUndefined();
  });

  it("throws for an unknown id", () => {
    expect(() => getStrategy("nope")).toThrow(/Unknown strategy "nope"/);
    expect(() => getStrategyInfo("nope")).toThrow(/Unknown strategy/);
  });
});

describe("assertSomeLive / activeStrategies", () => {
  it("returns every LIVE strategy (several are allowed)", () => {
    expect(
      assertSomeLive([
        { strategyId: "dg-v1", mode: "LIVE" },
        { strategyId: "dg-v2", mode: "LIVE" },
        { strategyId: "old", mode: "OFF" },
      ]),
    ).toEqual(["dg-v1", "dg-v2"]);
  });
  it("throws when none is LIVE", () => {
    expect(() => assertSomeLive([{ strategyId: "dg-v1", mode: "TEST" }])).toThrow(/found none/);
    expect(() => assertSomeLive([])).toThrow();
  });
  it("the seeded modes are valid: dg-v1 LIVE, the others TEST", () => {
    const seeded = [
      { strategyId: "dg-v1", mode: "LIVE" as const },
      { strategyId: "dg-v2-candidate", mode: "TEST" as const },
      { strategyId: "gemini-fvg", mode: "TEST" as const },
      { strategyId: "pro-v1-swing", mode: "TEST" as const },
      { strategyId: "gemini-fvg-2r", mode: "TEST" as const },
      { strategyId: "london-break", mode: "TEST" as const },
    ];
    expect(assertSomeLive(seeded)).toEqual(["dg-v1"]);
    expect(activeStrategies(seeded).map((m) => m.strategyId)).toEqual([
      "dg-v1",
      "dg-v2-candidate",
      "gemini-fvg",
      "gemini-fvg-2r",
      "london-break",
      "pro-v1-swing",
    ]);
    for (const { strategyId } of seeded) expect(() => getStrategy(strategyId)).not.toThrow();
  });

  it("runs LIVE and TEST, skips OFF, LIVE first", () => {
    expect(
      activeStrategies([
        { strategyId: "b-test", mode: "TEST" },
        { strategyId: "off", mode: "OFF" },
        { strategyId: "a-live", mode: "LIVE" },
      ]).map((m) => m.strategyId),
    ).toEqual(["a-live", "b-test"]);
  });
});

describe("applyEvents", () => {
  const setup: OpenSetup = {
    dedupeKey: "a",
    direction: "SELL",
    sweepType: "PDH",
    sweepLevel: 1.107,
    sweepExtreme: 1.1078,
    sweepTime: "2026-11-03T23:30:00.000Z",
    bosLevel: 1.1015,
    expiresAt: "2026-11-04T01:45:00.000Z",
  };

  it("adds on SWEEP, updates on EXTEND, removes on CONFIRM/EXPIRE/SKIP_INVALID", () => {
    const added = applyEvents([], [{ type: "SWEEP", pair: "EUR_USD", ...setup }]);
    expect(added).toEqual([setup]);
    const extended = applyEvents(added, [{ type: "EXTEND", dedupeKey: "a", sweepExtreme: 1.109 }]);
    expect(extended[0]?.sweepExtreme).toBe(1.109);
    expect(applyEvents(extended, [{ type: "EXPIRE", dedupeKey: "a", time: "t" }])).toEqual([]);
    expect(applyEvents(extended, [{ type: "SKIP_INVALID", dedupeKey: "a", reason: "r" }])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [setup];
    applyEvents(input, [{ type: "EXTEND", dedupeKey: "a", sweepExtreme: 1.2 }]);
    expect(input[0]?.sweepExtreme).toBe(1.1078);
  });
});
