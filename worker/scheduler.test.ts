import { describe, expect, it } from "vitest";
import { hasCandleClosingAt, nextRunAt } from "./scheduler";

const iso = (d: Date) => d.toISOString();
const at = (s: string) => new Date(s);

describe("nextRunAt", () => {
  it("runs 10 s after the next quarter-hour mid-week", () => {
    expect(iso(nextRunAt(at("2026-11-04T14:07:00Z")))).toBe("2026-11-04T14:15:10.000Z");
    expect(iso(nextRunAt(at("2026-11-04T14:15:05Z")))).toBe("2026-11-04T14:15:10.000Z");
    expect(iso(nextRunAt(at("2026-11-04T14:15:10Z")))).toBe("2026-11-04T14:30:10.000Z");
    expect(iso(nextRunAt(at("2026-11-04T14:59:59Z")))).toBe("2026-11-04T15:00:10.000Z");
  });

  it("still runs at the Friday close to process the last candle of the week", () => {
    // Fri 30 Oct 2026, 16:50 EDT → the 16:45–17:00 candle closes at 17:00 EDT (21:00Z).
    expect(iso(nextRunAt(at("2026-10-30T20:50:00Z")))).toBe("2026-10-30T21:00:10.000Z");
  });

  it("sleeps over the weekend until the first candle after the Sunday open", () => {
    // After the Friday close run → Sunday 1 Nov 17:15 EST (22:15Z), not 17:00.
    expect(iso(nextRunAt(at("2026-10-30T21:00:10Z")))).toBe("2026-11-01T22:15:10.000Z");
    expect(iso(nextRunAt(at("2026-10-31T12:00:00Z")))).toBe("2026-11-01T22:15:10.000Z");
    expect(iso(nextRunAt(at("2026-11-01T22:00:05Z")))).toBe("2026-11-01T22:15:10.000Z");
  });

  it("handles the March DST weekend (Sunday open at 21:00Z)", () => {
    expect(iso(nextRunAt(at("2026-03-07T12:00:00Z")))).toBe("2026-03-08T21:15:10.000Z");
  });

  it("knows which quarter-hours close a market candle", () => {
    expect(hasCandleClosingAt(at("2026-10-30T21:00:00Z"))).toBe(true); // Fri 17:00 EDT
    expect(hasCandleClosingAt(at("2026-10-30T21:15:00Z"))).toBe(false); // after close
    expect(hasCandleClosingAt(at("2026-11-01T22:00:00Z"))).toBe(false); // Sun 17:00 EST
    expect(hasCandleClosingAt(at("2026-11-01T22:15:00Z"))).toBe(true);
  });
});
