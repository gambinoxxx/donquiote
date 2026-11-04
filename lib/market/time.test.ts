import { describe, expect, it } from "vitest";
import { isMarketOpen, lastClosedCandleOpen } from "@/lib/market/time";

// 2026 US DST: starts Sun 8 Mar (EST UTC-5 -> EDT UTC-4), ends Sun 1 Nov.
const utc = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();

describe("isMarketOpen", () => {
  it("is open mid-week", () => {
    expect(isMarketOpen(utc("2026-11-04T14:07:00Z"))).toBe(true);
  });

  it("closes at Friday 17:00 New York (EDT, before the November change)", () => {
    expect(isMarketOpen(utc("2026-10-30T20:59:59Z"))).toBe(true); // 16:59:59 EDT
    expect(isMarketOpen(utc("2026-10-30T21:00:00Z"))).toBe(false); // 17:00 EDT
  });

  it("opens at Sunday 17:00 New York (EST, right after the November change)", () => {
    expect(isMarketOpen(utc("2026-11-01T21:59:59Z"))).toBe(false); // 16:59:59 EST
    expect(isMarketOpen(utc("2026-11-01T22:00:00Z"))).toBe(true); // 17:00 EST
  });

  it("closes at Friday 17:00 New York (EST, before the March change)", () => {
    expect(isMarketOpen(utc("2026-03-06T21:59:00Z"))).toBe(true); // 16:59 EST
    expect(isMarketOpen(utc("2026-03-06T22:00:00Z"))).toBe(false); // 17:00 EST
  });

  it("opens at Sunday 17:00 New York (EDT, the day DST starts)", () => {
    expect(isMarketOpen(utc("2026-03-08T20:59:00Z"))).toBe(false); // 16:59 EDT
    expect(isMarketOpen(utc("2026-03-08T21:00:00Z"))).toBe(true); // 17:00 EDT
  });

  it("is closed all of Saturday", () => {
    expect(isMarketOpen(utc("2026-10-31T00:00:00Z"))).toBe(false);
    expect(isMarketOpen(utc("2026-10-31T12:00:00Z"))).toBe(false);
    expect(isMarketOpen(utc("2026-11-01T03:59:00Z"))).toBe(false); // Sat 23:59 EDT
  });

  it("is closed on Sunday before the open", () => {
    expect(isMarketOpen(utc("2026-11-01T15:00:00Z"))).toBe(false);
  });
});

describe("lastClosedCandleOpen — M15", () => {
  it("returns the previous 15-minute candle mid-week", () => {
    expect(iso(lastClosedCandleOpen("M15", utc("2026-11-04T14:07:00Z")))).toBe(
      "2026-11-04T13:45:00.000Z",
    );
  });

  it("treats a candle as closed exactly at its close time", () => {
    expect(iso(lastClosedCandleOpen("M15", utc("2026-11-04T14:00:00Z")))).toBe(
      "2026-11-04T13:45:00.000Z",
    );
    expect(iso(lastClosedCandleOpen("M15", utc("2026-11-04T13:59:59Z")))).toBe(
      "2026-11-04T13:30:00.000Z",
    );
  });

  it("returns Friday 16:45 NY at the Friday close and over the weekend", () => {
    const friday1645 = "2026-10-30T20:45:00.000Z"; // 16:45 EDT
    expect(iso(lastClosedCandleOpen("M15", utc("2026-10-30T21:00:00Z")))).toBe(friday1645);
    expect(iso(lastClosedCandleOpen("M15", utc("2026-10-31T12:00:00Z")))).toBe(friday1645);
  });

  it("skips the weekend right after the Sunday open, then resumes", () => {
    // Sun 17:05 EST: the first Sunday candle (17:00) is still forming.
    expect(iso(lastClosedCandleOpen("M15", utc("2026-11-01T22:05:00Z")))).toBe(
      "2026-10-30T20:45:00.000Z",
    );
    expect(iso(lastClosedCandleOpen("M15", utc("2026-11-01T22:16:00Z")))).toBe(
      "2026-11-01T22:00:00.000Z",
    );
  });
});

describe("lastClosedCandleOpen — H4 (aligned to 17:00 NY)", () => {
  it("uses EST boundaries in winter (17,21,1,5,9,13 NY = 22,02,06,10,14,18 UTC)", () => {
    // Wed 09:07 EST: current candle opened 09:00 EST (14:00Z); last closed 05:00 EST.
    expect(iso(lastClosedCandleOpen("H4", utc("2026-11-04T14:07:00Z")))).toBe(
      "2026-11-04T10:00:00.000Z",
    );
  });

  it("uses EDT boundaries in summer (… = 21,01,05,09,13,17 UTC)", () => {
    // Wed 10:07 EDT: current candle opened 09:00 EDT (13:00Z); last closed 05:00 EDT.
    expect(iso(lastClosedCandleOpen("H4", utc("2026-06-10T14:07:00Z")))).toBe(
      "2026-06-10T09:00:00.000Z",
    );
  });

  it("closes exactly on the 4-hour boundary", () => {
    expect(iso(lastClosedCandleOpen("H4", utc("2026-11-04T14:00:00Z")))).toBe(
      "2026-11-04T10:00:00.000Z",
    );
    expect(iso(lastClosedCandleOpen("H4", utc("2026-11-04T13:59:59Z")))).toBe(
      "2026-11-04T06:00:00.000Z",
    );
  });

  it("returns Friday 13:00 NY at the close, on the weekend and just after the open", () => {
    const friday1300 = "2026-10-30T17:00:00.000Z"; // 13:00 EDT
    expect(iso(lastClosedCandleOpen("H4", utc("2026-10-30T21:00:00Z")))).toBe(friday1300);
    expect(iso(lastClosedCandleOpen("H4", utc("2026-10-31T12:00:00Z")))).toBe(friday1300);
    expect(iso(lastClosedCandleOpen("H4", utc("2026-11-01T22:05:00Z")))).toBe(friday1300);
  });

  it("follows the March DST change", () => {
    // Mon 9 Mar 11:00 EDT: current 09:00 EDT (13:00Z); last closed 05:00 EDT.
    expect(iso(lastClosedCandleOpen("H4", utc("2026-03-09T15:00:00Z")))).toBe(
      "2026-03-09T09:00:00.000Z",
    );
    // Fri 6 Mar 12:30 EST (still winter): last closed 05:00 EST = 10:00Z.
    expect(iso(lastClosedCandleOpen("H4", utc("2026-03-06T17:30:00Z")))).toBe(
      "2026-03-06T10:00:00.000Z",
    );
  });
});

describe("lastClosedCandleOpen — D (17:00 NY day)", () => {
  it("returns yesterday's 17:00 NY open mid-week (EST)", () => {
    // Wed 09:07 EST: today's candle opened Tue 17:00 EST; last closed Mon 17:00 EST.
    expect(iso(lastClosedCandleOpen("D", utc("2026-11-04T14:07:00Z")))).toBe(
      "2026-11-02T22:00:00.000Z",
    );
  });

  it("closes exactly at 17:00 NY", () => {
    expect(iso(lastClosedCandleOpen("D", utc("2026-11-04T22:00:00Z")))).toBe(
      "2026-11-03T22:00:00.000Z",
    );
    expect(iso(lastClosedCandleOpen("D", utc("2026-11-04T21:59:59Z")))).toBe(
      "2026-11-02T22:00:00.000Z",
    );
  });

  it("returns Thursday 17:00 NY at the Friday close and over the weekend", () => {
    const thursday = "2026-10-29T21:00:00.000Z"; // Thu 17:00 EDT
    expect(iso(lastClosedCandleOpen("D", utc("2026-10-30T21:00:00Z")))).toBe(thursday);
    expect(iso(lastClosedCandleOpen("D", utc("2026-10-31T12:00:00Z")))).toBe(thursday);
    expect(iso(lastClosedCandleOpen("D", utc("2026-11-01T22:05:00Z")))).toBe(thursday);
  });

  it("spans the November DST change (EDT Thursday -> EST Sunday candle)", () => {
    // Mon 2 Nov 07:00 EST: current = Sun 17:00 EST; last closed = Thu 29 Oct 17:00 EDT.
    expect(iso(lastClosedCandleOpen("D", utc("2026-11-02T12:00:00Z")))).toBe(
      "2026-10-29T21:00:00.000Z",
    );
    // Tue 3 Nov 07:00 EST: last closed = the Sunday candle, Sun 17:00 EST = 22:00Z.
    expect(iso(lastClosedCandleOpen("D", utc("2026-11-03T12:00:00Z")))).toBe(
      "2026-11-01T22:00:00.000Z",
    );
  });

  it("spans the March DST change (EST Thursday -> EDT Sunday candle)", () => {
    // Mon 9 Mar 11:00 EDT: current = Sun 8 Mar 17:00 EDT; last closed = Thu 5 Mar 17:00 EST.
    expect(iso(lastClosedCandleOpen("D", utc("2026-03-09T15:00:00Z")))).toBe(
      "2026-03-05T22:00:00.000Z",
    );
    // Tue 10 Mar 11:00 EDT: last closed = Sun 8 Mar 17:00 EDT = 21:00Z.
    expect(iso(lastClosedCandleOpen("D", utc("2026-03-10T15:00:00Z")))).toBe(
      "2026-03-08T21:00:00.000Z",
    );
  });
});
