import { describe, expect, it } from "vitest";
import { applyEvents } from "./apply-events";
import { activeStrategies, assertSomeLive } from "./modes";
import { getStrategy, listStrategies } from "./registry";
import type { OpenSetup } from "./types";

describe("registry", () => {
  it("lists dg-v1", () => {
    expect(listStrategies().map((s) => s.id)).toEqual(["dg-v1"]);
    expect(getStrategy("dg-v1").name).toBe("DG v1 · sweep + 15m BOS");
  });
  it("throws for an unknown id", () => {
    expect(() => getStrategy("nope")).toThrow(/Unknown strategy "nope"/);
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
