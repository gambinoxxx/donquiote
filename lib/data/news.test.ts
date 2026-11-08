import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
const { buildCalendar, groupByLagosDay, lagosDayStart, newsRangeBounds } = await import("./news");

const ev = (time: string) => ({ id: time, currency: "USD", title: "CPI", time, forecast: "0.3%", previous: null, actual: "0.4%", notifiedAt: null });

describe("news ranges and day groups (Lagos, UTC+1)", () => {
  // Saturday 7 Nov 2026, 16:30 Lagos.
  const now = new Date("2026-11-07T15:30:00Z");
  it("Lagos day starts at 23:00 UTC the day before", () => {
    expect(new Date(lagosDayStart(now.getTime())).toISOString()).toBe("2026-11-06T23:00:00.000Z");
  });
  it("This week runs from Monday to 14 days after today", () => {
    const { from, to } = newsRangeBounds("week", now);
    expect(from.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-20T23:00:00.000Z");
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

describe("calendar: upcoming first, past days collapsed", () => {
  const noActual = (time: string) => ({ ...ev(time), actual: null });
  // Sunday 8 Nov 2026, 10:00 Lagos: last week's events are stored, next week's just arrived.
  const sunday = new Date("2026-11-08T09:00:00Z");
  const stored = [
    noActual("2026-11-06T13:30:00Z"), // Fri 6 Nov (last week)
    noActual("2026-11-05T19:00:00Z"), // Thu 5 Nov
    noActual("2026-11-09T15:00:00Z"), // Mon 9 Nov
    noActual("2026-11-13T13:30:00Z"), // Fri 13 Nov
    noActual("2026-11-10T07:00:00Z"), // Tue 10 Nov
  ];

  it("on Sunday the range reaches the whole of next week", () => {
    const { from, to } = newsRangeBounds("week", sunday);
    expect(from.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(Date.parse("2026-11-13T13:30:00Z")).toBeLessThan(to.getTime());
    expect(Date.parse("2026-11-14T20:00:00Z")).toBeLessThan(to.getTime());
  });

  it("on Sunday next week's events come first, in order, and last week's collapse", () => {
    const cal = buildCalendar(stored, sunday);
    expect(cal.upcoming.map((g) => g.label)).toEqual(["Tomorrow · Mon 9 Nov", "Tue 10 Nov", "Fri 13 Nov"]);
    expect(cal.earlier.map((g) => g.label)).toEqual(["Thu 5 Nov", "Fri 6 Nov"]);
    expect(cal.hasActuals).toBe(false);
  });

  it("today stays in upcoming (first) even after some of its events passed", () => {
    const tue = new Date("2026-11-10T12:00:00Z");
    const cal = buildCalendar([...stored, noActual("2026-11-10T19:00:00Z")], tue);
    expect(cal.upcoming[0]!.label).toBe("Today · Tue 10 Nov");
    expect(cal.upcoming[0]!.events).toHaveLength(2);
    expect(cal.upcoming.map((g) => g.label)).toEqual(["Today · Tue 10 Nov", "Fri 13 Nov"]);
    expect(cal.earlier.map((g) => g.label)).toEqual(["Thu 5 Nov", "Fri 6 Nov", "Mon 9 Nov"]);
  });

  it("hasActuals once any event carries an actual figure", () => {
    expect(buildCalendar([ev("2026-11-06T13:30:00Z")], sunday).hasActuals).toBe(true);
    expect(buildCalendar([], sunday)).toEqual({ upcoming: [], earlier: [], hasActuals: false });
  });
});
