import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/types";
import { findLongGaps } from "./gaps";

const H = 3_600_000;
const c = (time: string): Candle => ({ time, open: 1, high: 1, low: 1, close: 1 });

describe("findLongGaps", () => {
  it("accepts a normal weekend for each timeframe", () => {
    // M15: Fri 16:45 EDT -> Sun 17:00 EDT
    expect(findLongGaps([c("2026-10-23T20:45:00.000Z"), c("2026-10-25T21:00:00.000Z")], 0.25 * H)).toEqual([]);
    // H4: Fri 13:00 EDT -> Sun 17:00 EST (clocks went back: 53h)
    expect(findLongGaps([c("2026-10-30T17:00:00.000Z"), c("2026-11-01T22:00:00.000Z")], 4 * H)).toEqual([]);
    // D: Thu 17:00 EDT -> Sun 17:00 EST (73h)
    expect(findLongGaps([c("2026-10-29T21:00:00.000Z"), c("2026-11-01T22:00:00.000Z")], 24 * H)).toEqual([]);
  });

  it("flags a gap longer than a weekend", () => {
    const gaps = findLongGaps([c("2026-12-24T20:45:00.000Z"), c("2026-12-28T22:00:00.000Z")], 0.25 * H);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.hours).toBeCloseTo(97.25);
  });
});
