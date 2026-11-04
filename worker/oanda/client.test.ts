import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/eur-usd-m15.json";
import {
  createOandaClient,
  MAX_ATTEMPTS,
  MAX_CANDLES_PER_REQUEST,
  OandaAuthError,
  OandaError,
} from "./client";

const TOKEN = "test-token-should-never-be-logged";
const M15_MS = 15 * 60_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function rawCandle(timeMs: number, complete = true) {
  return {
    complete,
    volume: 1,
    time: new Date(timeMs).toISOString().replace(".000Z", ".000000000Z"),
    mid: { o: "1.10000", h: "1.10100", l: "1.09900", c: "1.10050" },
  };
}

function setup(fetchImpl: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => fetchImpl(String(input)));
  const sleep = vi.fn(async () => {});
  const logs: Record<string, unknown>[] = [];
  const client = createOandaClient({
    token: TOKEN,
    env: "practice",
    fetch: fetchMock as unknown as typeof fetch,
    sleep,
    logger: (fields) => logs.push(fields),
    now: () => Date.parse("2026-11-04T14:07:00Z"),
  });
  return { client, fetchMock, sleep, logs };
}

describe("request shape", () => {
  it("calls the practice candles endpoint with mid prices and 17:00 NY alignment", async () => {
    const { client, fetchMock } = setup(async () => jsonResponse(fixture));
    await client.fetchCandles("EUR_USD", "M15", { count: 3 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://api-fxpractice.oanda.com");
    expect(parsed.pathname).toBe("/v3/instruments/EUR_USD/candles");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      granularity: "M15",
      price: "M",
      dailyAlignment: "17",
      alignmentTimezone: "America/New_York",
      count: "4",
    });
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      "Accept-Datetime-Format": "RFC3339",
    });
  });
});

describe("fetchCandles({ count })", () => {
  it("returns the latest N closed candles, oldest first, without the forming one", async () => {
    const { client } = setup(async () => jsonResponse(fixture));
    const candles = await client.fetchCandles("EUR_USD", "M15", { count: 2 });
    expect(candles.map((c) => c.time)).toEqual([
      "2026-11-04T13:30:00.000Z",
      "2026-11-04T13:45:00.000Z",
    ]);
  });

  it("rejects out-of-range counts", async () => {
    const { client } = setup(async () => jsonResponse(fixture));
    await expect(client.fetchCandles("EUR_USD", "M15", { count: 0 })).rejects.toThrow(RangeError);
    await expect(
      client.fetchCandles("EUR_USD", "M15", { count: MAX_CANDLES_PER_REQUEST }),
    ).rejects.toThrow(RangeError);
  });
});

describe("fetchCandles({ from, to }) paging", () => {
  // A fake OANDA serving one complete M15 candle every 15 minutes up to `nowMs`
  // (the candle at nowMs is still forming), honouring from/count/includeFirst.
  function fakeOanda(nowMs: number) {
    return async (url: string) => {
      const params = new URL(url).searchParams;
      const fromMs = Date.parse(params.get("from") ?? "");
      const count = Number(params.get("count"));
      const includeFirst = params.get("includeFirst") !== "false";
      let t = Math.ceil(fromMs / M15_MS) * M15_MS;
      // Like the real API: with includeFirst=false the skipped cursor candle
      // still counts towards `count`, so a full page holds count - 1.
      let limit = count;
      if (!includeFirst && t === fromMs) {
        t += M15_MS;
        limit = count - 1;
      }
      const candles = [];
      while (candles.length < limit && t <= nowMs) {
        candles.push(rawCandle(t, t < nowMs));
        t += M15_MS;
      }
      return jsonResponse({ instrument: "EUR_USD", granularity: "M15", candles });
    };
  }

  it("pages through ranges larger than 5000 candles with no duplicates or gaps", async () => {
    const from = new Date("2026-06-01T00:00:00Z");
    const to = new Date(from.getTime() + 12_000 * M15_MS); // 12,000 candles
    const nowMs = to.getTime() + 100 * M15_MS;
    const { client, fetchMock } = setup(fakeOanda(nowMs));

    const candles = await client.fetchCandles("EUR_USD", "M15", { from, to });

    expect(candles).toHaveLength(12_000);
    expect(new Set(candles.map((c) => c.time)).size).toBe(12_000);
    expect(candles[0]?.time).toBe(from.toISOString());
    expect(candles.at(-1)?.time).toBe(new Date(to.getTime() - M15_MS).toISOString());
    for (let i = 1; i < candles.length; i++) {
      expect(Date.parse(candles[i]!.time) - Date.parse(candles[i - 1]!.time)).toBe(M15_MS);
    }
    // 5000 + 4999 + 4999 = 14,998 >= 12,000 → 3 requests.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Later pages exclude the cursor candle to avoid duplicates.
    const secondUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(secondUrl.searchParams.get("includeFirst")).toBe("false");
  });

  it("stops at the present and drops the forming candle", async () => {
    const from = new Date("2026-11-04T12:00:00Z");
    const nowMs = Date.parse("2026-11-04T14:00:00Z");
    const { client, fetchMock } = setup(fakeOanda(nowMs));

    const candles = await client.fetchCandles("EUR_USD", "M15", {
      from,
      to: new Date("2026-11-05T00:00:00Z"),
    });

    expect(candles.map((c) => c.time)).toEqual([
      "2026-11-04T12:00:00.000Z",
      "2026-11-04T12:15:00.000Z",
      "2026-11-04T12:30:00.000Z",
      "2026-11-04T12:45:00.000Z",
      "2026-11-04T13:00:00.000Z",
      "2026-11-04T13:15:00.000Z",
      "2026-11-04T13:30:00.000Z",
      "2026-11-04T13:45:00.000Z",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty or reversed range", async () => {
    const { client } = setup(fakeOanda(Date.now()));
    const t = new Date("2026-11-04T12:00:00Z");
    await expect(client.fetchCandles("EUR_USD", "M15", { from: t, to: t })).rejects.toThrow(
      RangeError,
    );
  });
});

describe("retries", () => {
  it.each([429, 500, 502, 503])("retries HTTP %i with exponential backoff, then succeeds", async (status) => {
    let calls = 0;
    const { client, fetchMock, sleep } = setup(async () =>
      ++calls < 3 ? jsonResponse({ errorMessage: "busy" }, status) : jsonResponse(fixture),
    );
    const candles = await client.fetchCandles("EUR_USD", "M15", { count: 3 });
    expect(candles).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([500, 1000]);
  });

  it(`gives up after ${MAX_ATTEMPTS} attempts`, async () => {
    const { client, fetchMock, sleep } = setup(async () => jsonResponse({ errorMessage: "down" }, 503));
    await expect(client.fetchCandles("EUR_USD", "M15", { count: 3 })).rejects.toThrow(OandaError);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([500, 1000, 2000]);
  });

  it("retries network errors and timeouts", async () => {
    let calls = 0;
    const { client, fetchMock } = setup(async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      if (calls === 2) throw new DOMException("The operation timed out.", "TimeoutError");
      return jsonResponse(fixture);
    });
    await expect(client.fetchCandles("EUR_USD", "M15", { count: 3 })).resolves.toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])("never retries HTTP %i and throws a clear token error", async (status) => {
    const { client, fetchMock, sleep } = setup(async () =>
      jsonResponse({ errorMessage: "Insufficient authorization" }, status),
    );
    const error = await client.fetchCandles("EUR_USD", "M15", { count: 3 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OandaAuthError);
    expect((error as Error).message).toMatch(/OANDA token rejected/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry other 4xx errors", async () => {
    const { client, fetchMock } = setup(async () =>
      jsonResponse({ errorMessage: "Invalid value specified for 'granularity'" }, 400),
    );
    await expect(client.fetchCandles("EUR_USD", "M15", { count: 3 })).rejects.toThrow(
      /HTTP 400.*granularity/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a malformed response", async () => {
    const { client, fetchMock } = setup(async () => jsonResponse({ candles: "bad" }));
    await expect(client.fetchCandles("EUR_USD", "M15", { count: 3 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("logging", () => {
  it("logs structured fields and never the token", async () => {
    let calls = 0;
    const { client, logs } = setup(async () =>
      ++calls === 1 ? jsonResponse({}, 500) : jsonResponse(fixture),
    );
    await client.fetchCandles("EUR_USD", "M15", { count: 3 });
    expect(logs.at(-1)).toMatchObject({
      component: "oanda",
      pair: "EUR_USD",
      timeframe: "M15",
      count: 3,
      outcome: "ok",
    });
    expect(logs.some((l) => l.outcome === "retry")).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  it("keeps the token out of auth errors", async () => {
    const { client } = setup(async () => jsonResponse({}, 401));
    const error = await client.fetchCandles("EUR_USD", "M15", { count: 3 }).catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain(TOKEN);
  });
});
