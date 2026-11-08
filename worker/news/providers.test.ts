import { describe, expect, it } from "vitest";
import { FOREX_FACTORY_NEXT_WEEK_URL, FOREX_FACTORY_URL, forexFactoryProvider } from "./providers";

const row = (date: string, title = "CPI m/m", country = "USD") => ({ title, country, date, impact: "High", forecast: "0.3%", previous: "0.4%" });
const THIS_WEEK = [row("2026-11-08T17:30:00-05:00", "Retail Sales m/m"), row("2026-11-12T08:30:00-05:00")];
const NEXT_WEEK = [row("2026-11-16T08:30:00-05:00", "Empire State Manufacturing Index"), row("2026-11-20T04:30:00-05:00", "Flash Services PMI", "GBP")];

type Reply = { status: number; body?: unknown; etag?: string };

/** A fake fetch: one reply per URL per call (the last one repeats). */
function fakeFetch(replies: Record<string, Reply[]>) {
  const calls: Array<{ url: string; ifNoneMatch: string | null }> = [];
  const count: Record<string, number> = {};
  const impl = async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, ifNoneMatch: headers["If-None-Match"] ?? null });
    const list = replies[url] ?? [{ status: 404 }];
    const i = count[url] ?? 0;
    count[url] = i + 1;
    const r = list[Math.min(i, list.length - 1)]!;
    const body = r.body === undefined ? (r.status === 404 ? "<html>404 Not Found</html>" : "") : JSON.stringify(r.body);
    return new Response(r.status === 304 ? null : body, { status: r.status, headers: r.etag ? { etag: r.etag } : {} });
  };
  return { impl, calls };
}

describe("Forex Factory provider: this week + next week", () => {
  it("merges both weeks, oldest first", async () => {
    const { impl, calls } = fakeFetch({
      [FOREX_FACTORY_URL]: [{ status: 200, body: THIS_WEEK }],
      [FOREX_FACTORY_NEXT_WEEK_URL]: [{ status: 200, body: NEXT_WEEK }],
    });
    const events = await forexFactoryProvider(impl).fetchEvents();
    expect(calls.map((c) => c.url)).toEqual([FOREX_FACTORY_URL, FOREX_FACTORY_NEXT_WEEK_URL]);
    expect(events!.map((e) => e.time)).toEqual([
      "2026-11-08T22:30:00.000Z",
      "2026-11-12T13:30:00.000Z",
      "2026-11-16T13:30:00.000Z",
      "2026-11-20T09:30:00.000Z",
    ]);
  });

  it("a missing next-week feed (404) is not an error", async () => {
    const { impl } = fakeFetch({ [FOREX_FACTORY_URL]: [{ status: 200, body: THIS_WEEK }], [FOREX_FACTORY_NEXT_WEEK_URL]: [{ status: 404 }] });
    const events = await forexFactoryProvider(impl).fetchEvents();
    expect(events).toHaveLength(2);
  });

  it("a missing this-week feed is still an error", async () => {
    const { impl } = fakeFetch({ [FOREX_FACTORY_URL]: [{ status: 404 }], [FOREX_FACTORY_NEXT_WEEK_URL]: [{ status: 200, body: NEXT_WEEK }] });
    await expect(forexFactoryProvider(impl).fetchEvents()).rejects.toThrow("forexfactory: HTTP 404");
  });

  it("returns null only when both are unchanged; one change still returns both weeks", async () => {
    const { impl, calls } = fakeFetch({
      [FOREX_FACTORY_URL]: [{ status: 200, body: THIS_WEEK, etag: '"a"' }, { status: 304 }],
      [FOREX_FACTORY_NEXT_WEEK_URL]: [{ status: 404 }, { status: 404 }, { status: 200, body: NEXT_WEEK, etag: '"b"' }],
    });
    const provider = forexFactoryProvider(impl);
    expect(await provider.fetchEvents()).toHaveLength(2);
    // This week 304 (sent its ETag), next week still 404 → treated as a change to "no events": both weeks returned.
    expect(await provider.fetchEvents()).toHaveLength(2);
    expect(calls[2]).toEqual({ url: FOREX_FACTORY_URL, ifNoneMatch: '"a"' });
    // Next week appears while this week is unchanged.
    expect(await provider.fetchEvents()).toHaveLength(4);
  });

  it("both unchanged → null", async () => {
    const { impl } = fakeFetch({
      [FOREX_FACTORY_URL]: [{ status: 200, body: THIS_WEEK, etag: '"a"' }, { status: 304 }],
      [FOREX_FACTORY_NEXT_WEEK_URL]: [{ status: 200, body: NEXT_WEEK, etag: '"b"' }, { status: 304 }],
    });
    const provider = forexFactoryProvider(impl);
    expect(await provider.fetchEvents()).toHaveLength(4);
    expect(await provider.fetchEvents()).toBeNull();
  });
});
