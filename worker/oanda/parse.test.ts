import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/eur-usd-m15.json";
import { normalizeOandaTime, parseCandlesResponse } from "./parse";

describe("parseCandlesResponse", () => {
  it("drops incomplete candles and converts mid prices to numbers", () => {
    const { candles, rawCount } = parseCandlesResponse(fixture);
    expect(rawCount).toBe(4);
    expect(candles).toHaveLength(3);
    expect(candles.map((c) => c.time)).toEqual([
      "2026-11-04T13:15:00.000Z",
      "2026-11-04T13:30:00.000Z",
      "2026-11-04T13:45:00.000Z",
    ]);
    expect(candles[0]).toEqual({
      time: "2026-11-04T13:15:00.000Z",
      open: 1.07412,
      high: 1.07455,
      low: 1.07398,
      close: 1.0744,
    });
  });

  it("never returns the forming candle", () => {
    const { candles } = parseCandlesResponse(fixture);
    expect(candles.some((c) => c.time === "2026-11-04T14:00:00.000Z")).toBe(false);
  });

  it("rejects malformed responses", () => {
    expect(() => parseCandlesResponse({ candles: "nope" })).toThrow();
    expect(() =>
      parseCandlesResponse({
        instrument: "EUR_USD",
        granularity: "M15",
        candles: [{ complete: true, volume: 1, time: "x", mid: { o: "abc", h: "1", l: "1", c: "1" } }],
      }),
    ).toThrow();
  });
});

describe("normalizeOandaTime", () => {
  it("trims nanoseconds to milliseconds", () => {
    expect(normalizeOandaTime("2026-11-03T22:00:00.123456789Z")).toBe("2026-11-03T22:00:00.123Z");
    expect(normalizeOandaTime("2026-11-03T22:00:00Z")).toBe("2026-11-03T22:00:00.000Z");
  });
  it("throws on garbage", () => {
    expect(() => normalizeOandaTime("not a time")).toThrow();
  });
});
