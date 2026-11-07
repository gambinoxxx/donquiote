import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
const { groupByLagosDay, lagosDayStart, newsRangeBounds } = await import("./news");

const ev = (time: string) => ({ id: time, currency: "USD", title: "CPI", time, forecast: "0.3%", previous: null, actual: "0.4%", notifiedAt: null });

describe("news ranges and day groups (Lagos, UTC+1)", () => {
  // Saturday 7 Nov 2026, 16:30 Lagos.
  const now = new Date("2026-11-07T15:30:00Z");
  it("Lagos day starts at 23:00 UTC the day before", () => {
    expect(new Date(lagosDayStart(now.getTime())).toISOString()).toBe("2026-11-06T23:00:00.000Z");
  });
  it("This week runs from Monday to 7 days after today", () => {
    const { from, to } = newsRangeBounds("week", now);
    expect(from.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-13T23:00:00.000Z");
    expect(newsRangeBounds("tomorrow", now).from.toISOString()).toBe("2026-11-07T23:00:00.000Z");
  });
  it("groups by Lagos day with Today / Tomorrow labels and actual vs forecast", () => {
    const groups = groupByLagosDay([ev("2026-11-08T08:00:00Z"), ev("2026-11-06T13:30:00Z"), ev("2026-11-07T22:59:00Z"), ev("2026-11-07T23:00:00Z")], now);
    expect(groups.map((g) => [g.label, g.events.length])).toEqual([
      ["Fri 6 Nov", 1],
      ["Today · Sat 7 Nov", 1],
      ["Tomorrow · Sun 8 Nov", 2],
    ]);
    expect(groups[0]!.events[0]!.vsForecast).toBe("above");
  });
});
