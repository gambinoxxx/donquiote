import { describe, expect, it, vi } from "vitest";
import type { PushClient } from "@/lib/notify/push";
import type { CalendarEventInput, HeadlineInput } from "@/lib/news/types";
import { runScheduler } from "../scheduler";
import { silentLogger } from "../log";
import { NewsRunner } from "./jobs";
import type { CalendarProvider, HeadlineProvider } from "./providers";
import { MemoryNewsStore } from "./store";

const MIN = 60_000;
// Tuesday, market open.
const NOW = new Date("2026-11-10T13:00:00.000Z");
const at = (min: number) => new Date(NOW.getTime() + min * MIN).toISOString();

const event = (min: number, extra: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  source: "forexfactory",
  externalId: `forexfactory:USD:CPI m/m:${at(min)}`,
  currency: "USD",
  title: "CPI m/m",
  impact: "HIGH",
  time: at(min),
  forecast: "0.3%",
  previous: "0.4%",
  actual: null,
  ...extra,
});

function calendarOf(...batches: Array<CalendarEventInput[] | null | Error>): CalendarProvider {
  let i = 0;
  return {
    id: "forexfactory",
    fetchEvents: async () => {
      const b = batches[Math.min(i++, batches.length - 1)];
      if (b instanceof Error) throw b;
      return b ?? null;
    },
  };
}

function headlinesOf(id: "fed" | "whitehouse" | "finnhub", items: HeadlineInput[] | Error): HeadlineProvider {
  return {
    id,
    fetchHeadlines: async () => {
      if (items instanceof Error) throw items;
      return items;
    },
  };
}

const head = (min: number, title: string, source: "fed" | "whitehouse" | "finnhub" = "finnhub"): HeadlineInput => ({
  source,
  externalId: `${source}:${title}`,
  title,
  url: "https://example.com",
  publishedAt: at(min),
});

function pushClient() {
  const send = vi.fn(async () => {});
  return { client: { send } as PushClient, send };
}

function runner(store: MemoryNewsStore, opts: { calendar?: CalendarProvider; headlines?: HeadlineProvider[]; push?: { client: PushClient } | null } = {}) {
  store.targets = [{ id: "s1", endpoint: "https://push.example/x", p256dh: "k", auth: "a", failCount: 0 }];
  return new NewsRunner({
    store,
    calendar: opts.calendar ?? calendarOf([]),
    headlines: opts.headlines ?? [],
    push: opts.push === undefined ? pushClient() : opts.push,
    logger: silentLogger,
  });
}

describe("calendar job", () => {
  it("upserts idempotently and updates actual when it appears", async () => {
    const store = new MemoryNewsStore(() => NOW);
    const r = runner(store, { calendar: calendarOf([event(-60)], [event(-60)], [event(-60, { actual: "0.5%" })]) });
    await r.tick(NOW, { force: true });
    await r.tick(NOW, { force: true });
    expect(store.events).toHaveLength(1);
    await r.tick(NOW, { force: true });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]!.actual).toBe("0.5%");
  });

  it("is due every 30 min and once after 00:05 UTC", async () => {
    const store = new MemoryNewsStore(() => NOW);
    const r = runner(store);
    await r.tick(new Date("2026-11-10T23:50:00Z"));
    expect(r.calendarDue(new Date("2026-11-11T00:04:00Z"))).toBe(false);
    expect(r.calendarDue(new Date("2026-11-11T00:05:00Z"))).toBe(true);
    expect(r.calendarDue(new Date("2026-11-11T00:20:00Z"))).toBe(true);
  });

  it("headlines every 2 min while open, every 5 min at the weekend", async () => {
    const store = new MemoryNewsStore(() => NOW);
    const r = runner(store);
    await r.tick(NOW);
    expect(r.headlinesDue(new Date(NOW.getTime() + MIN))).toBe(false);
    expect(r.headlinesDue(new Date(NOW.getTime() + 2 * MIN))).toBe(true);
    const sat = new Date("2026-11-14T12:00:00Z");
    await r.tick(sat);
    expect(r.headlinesDue(new Date(sat.getTime() + 3 * MIN))).toBe(false);
    expect(r.headlinesDue(new Date(sat.getTime() + 5 * MIN))).toBe(true);
  });
});

describe("headline job", () => {
  it("classifies, stores once and drops near-duplicates across sources", async () => {
    const store = new MemoryNewsStore(() => NOW);
    const r = runner(store, {
      headlines: [
        headlinesOf("finnhub", [head(-3, "[Fixture] Fed cuts rates by 25 basis points"), head(-2, "[Fixture] Apple unveils a phone")]),
        headlinesOf("fed", [head(-3, "[Fixture] The Fed cuts rates by 25 basis points", "fed")]),
      ],
    });
    await r.tick(NOW, { force: true });
    await r.tick(NOW, { force: true });
    expect(store.headlines.map((h) => [h.title, h.impact])).toEqual([
      ["[Fixture] Fed cuts rates by 25 basis points", "HIGH"],
      ["[Fixture] Apple unveils a phone", "NORMAL"],
    ]);
  });
});

describe("pushes", () => {
  it("calendar: 15 min before, sent once across ticks", async () => {
    const store = new MemoryNewsStore(() => NOW);
    const push = pushClient();
    const r = runner(store, { calendar: calendarOf([event(15), event(40, { externalId: "later" })]), push });
    const first = await r.tick(NOW, { force: true });
    expect(first.calendarPushes).toBe(1);
    const second = await r.tick(new Date(NOW.getTime() + MIN));
    expect(second.calendarPushes).toBe(0);
    expect(push.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse((push.send.mock.calls[0] as unknown as [unknown, string])[1]).title).toBe("USD CPI m/m in 15 min");
  });

  it("headlines: throttled to one per 10 min with merging; old ones never", async () => {
    const store = new MemoryNewsStore(() => NOW);
    const push = pushClient();
    const r = runner(store, { push, headlines: [headlinesOf("finnhub", [head(-30, "[Fixture] Trump announces tariffs on Canada"), head(-1, "[Fixture] Fed cuts rates by 50 basis points")])] });
    expect((await r.tick(NOW, { force: true })).headlinePushes).toBe(1);
    // The 30-min-old one was never pushed.
    expect(store.headlines.find((h) => h.title.includes("Canada"))!.notifiedAt).toBeNull();

    store.headlines.push(
      { ...store.headlines[1]!, id: "x1", externalId: "x1", title: "[Fixture] ECB emergency meeting", publishedAt: at(2), notifiedAt: null },
      { ...store.headlines[1]!, id: "x2", externalId: "x2", title: "[Fixture] BoJ hikes rates", publishedAt: at(3), notifiedAt: null },
    );
    expect((await r.tick(new Date(NOW.getTime() + 5 * MIN))).headlinePushes).toBe(0);
    expect((await r.tick(new Date(NOW.getTime() + 10 * MIN))).headlinePushes).toBe(1);
    const last = JSON.parse((push.send.mock.calls.at(-1) as unknown as [unknown, string])[1]);
    expect(last.title).toContain("(+1 more)");
    expect(last.body.startsWith("[Fixture] BoJ hikes rates")).toBe(true);
  });

  it("respects the toggles, the master push switch and a missing push channel", async () => {
    for (const ctx of [{ newsPushCalendar: false }, { pushEnabled: false }]) {
      const store = new MemoryNewsStore(() => NOW);
      Object.assign(store.ctx, ctx);
      const push = pushClient();
      const r = runner(store, { calendar: calendarOf([event(10)]), push });
      expect((await r.tick(NOW, { force: true })).calendarPushes).toBe(0);
      expect(store.events[0]!.notifiedAt).toBeNull();
    }
    const store = new MemoryNewsStore(() => NOW);
    store.ctx.newsPushHeadlines = false;
    const r = runner(store, { headlines: [headlinesOf("finnhub", [head(-1, "[Fixture] Fed cuts rates by 50 basis points")])] });
    expect((await r.tick(NOW, { force: true })).headlinePushes).toBe(0);
    const noPush = runner(new MemoryNewsStore(() => NOW), { calendar: calendarOf([event(10)]), push: null });
    expect((await noPush.tick(NOW, { force: true })).calendarPushes).toBe(0);
  });

  it("only for currencies on the watchlist", async () => {
    const store = new MemoryNewsStore(() => NOW);
    store.ctx.watchedCurrencies = ["EUR", "GBP"];
    const r = runner(store, { calendar: calendarOf([event(10)]) });
    expect((await r.tick(NOW, { force: true })).calendarPushes).toBe(0);
  });
});

describe("failures", () => {
  it("a failing source is logged and shown in newsStatus; the others still run", async () => {
    const store = new MemoryNewsStore(() => NOW);
    const r = runner(store, {
      calendar: calendarOf(new Error("forexfactory: HTTP 429")),
      headlines: [headlinesOf("fed", new Error("fed: HTTP 503")), headlinesOf("whitehouse", [head(-2, "[Fixture] Executive order on tariffs", "whitehouse")])],
    });
    const report = await r.tick(NOW, { force: true });
    expect(report.calendar).toBe("error");
    expect(report.headlines).toEqual({ stored: 1, errors: 1 });
    expect(store.status).toContain("forexfactory error: forexfactory: HTTP 429");
    expect(store.status).toContain("fed error: fed: HTTP 503");
    expect(store.status).toContain("whitehouse ok");
  });

  it("tick never throws, even when the database fails", async () => {
    const store = new MemoryNewsStore(() => NOW);
    for (const k of ["upsertEvents", "loadPushContext", "deleteNewsBefore", "writeNewsStatus", "existingHeadlineIds"] as const) {
      vi.spyOn(store, k).mockRejectedValue(new Error("db down"));
    }
    const r = runner(store, { calendar: calendarOf([event(10)]), headlines: [headlinesOf("fed", [head(-1, "x", "fed")])] });
    await expect(r.tick(NOW, { force: true })).resolves.toBeDefined();
  });

  it("a failing news source doesn't stop the price cycle", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-10T13:14:55.000Z"));
      const stop = new AbortController();
      const cycles: Date[] = [];
      const store = new MemoryNewsStore();
      const r = runner(store, { calendar: calendarOf(new Error("down")), headlines: [headlinesOf("fed", new Error("down"))] });
      const cycle = async (now: Date) => {
        await r.tick(now, { force: true }); // news failing in the same process
        cycles.push(now);
        if (cycles.length === 2) stop.abort();
      };
      const done = runScheduler({ cycle, signal: stop.signal, logger: silentLogger });
      await vi.advanceTimersByTimeAsync(16 * MIN);
      await done;
      expect(cycles).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
