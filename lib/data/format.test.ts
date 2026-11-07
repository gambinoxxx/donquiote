import { describe, expect, it } from "vitest";
import { formatClock, formatDateTime, formatDay, formatDuration, formatPrice, formatR, formatUsd, formatWhen, pairLabel } from "./format";

const NOW = new Date("2026-11-04T09:42:00.000Z"); // 10:42 in Lagos (UTC+1, no DST)

describe("Lagos time formatter", () => {
  it("shows Lagos time (UTC+1 all year)", () => {
    expect(formatDateTime("2026-11-04T09:42:00.000Z")).toBe("Wed 4 Nov · 10:42");
    expect(formatClock("2026-07-15T23:30:00.000Z")).toBe("00:30"); // next day in Lagos
    expect(formatDay("2026-11-04T23:30:00.000Z")).toBe("Thu, 5 Nov");
  });

  it("within 24 hours: relative", () => {
    expect(formatWhen("2026-11-04T09:41:40.000Z", NOW)).toBe("just now");
    expect(formatWhen("2026-11-04T09:30:00.000Z", NOW)).toBe("12 min ago");
    expect(formatWhen("2026-11-04T06:42:00.000Z", NOW)).toBe("3 h ago");
    expect(formatWhen("2026-11-04T06:22:00.000Z", NOW)).toBe("3 h 20 min ago");
    expect(formatWhen("2026-11-03T09:43:00.000Z", NOW)).toBe("23 h 59 min ago");
    expect(formatWhen("2026-11-04T09:45:00.000Z", NOW)).toBe("just now"); // clock skew
  });

  it("24 hours or older: date and time in Lagos", () => {
    expect(formatWhen("2026-11-03T09:42:00.000Z", NOW)).toBe("Tue 3 Nov · 10:42");
    expect(formatWhen("2026-10-01T13:05:00.000Z", NOW)).toBe("Thu 1 Oct · 14:05");
  });
});

describe("prices and results", () => {
  it("prices use the pair's precision (JPY 3 decimals)", () => {
    expect(formatPrice("EUR_USD", 1.118)).toBe("1.11800");
    expect(formatPrice("USD_JPY", 156.78)).toBe("156.780");
    expect(pairLabel("USD_JPY")).toBe("USD/JPY");
  });

  it("R and USD with real minus signs", () => {
    expect(formatR(3)).toBe("+3R");
    expect(formatR(-1)).toBe("−1R");
    expect(formatR(0.68)).toBe("+0.68R");
    expect(formatUsd(150)).toBe("+$150");
    expect(formatUsd(-50)).toBe("−$50");
    expect(formatUsd(34.5)).toBe("+$34.50");
    expect(formatUsd(10000, { sign: false })).toBe("$10,000");
  });

  it("durations", () => {
    expect(formatDuration(195 * 60_000)).toBe("3h 15m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration((2 * 1440 + 4 * 60) * 60_000)).toBe("2d 4h");
  });
});
