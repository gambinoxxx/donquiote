// OANDA v20 REST client for candles. Worker and scripts only — never import
// from app/ (architecture invariant 2).
import { ZodError } from "zod";
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { MARKET_TIME_ZONE, DAY_START_HOUR_NY } from "@/lib/market/time";
import type { OandaEnv } from "../env";
import { jsonLogger, type Logger } from "../log";
import { parseCandlesResponse } from "./parse";

export const OANDA_BASE_URLS: Record<OandaEnv, string> = {
  practice: "https://api-fxpractice.oanda.com",
  live: "https://api-fxtrade.oanda.com",
};

/** OANDA returns at most this many candles per request. */
export const MAX_CANDLES_PER_REQUEST = 5000;
export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_ATTEMPTS = 4;
export const BASE_BACKOFF_MS = 500;

export type FetchCandlesOptions = { count: number } | { from: Date; to?: Date };

export class OandaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OandaError";
  }
}

/**
 * 401/403 that persisted through every attempt: the token is wrong, expired
 * or for the other environment.
 */
export class OandaAuthError extends OandaError {
  constructor(status: number, attempts: number) {
    super(
      `OANDA token rejected (HTTP ${status}, ${attempts} attempts). Check OANDA_API_TOKEN and that OANDA_ENV matches the account (practice/live).`,
      status,
    );
    this.name = "OandaAuthError";
  }
}

export interface OandaClientConfig {
  token: string;
  env: OandaEnv;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

export interface OandaClient {
  /** Closed candles only, oldest first, no duplicates. */
  fetchCandles(pair: Pair, timeframe: Timeframe, opts: FetchCandlesOptions): Promise<Candle[]>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retried statuses. 401/403 are included on purpose: OANDA's practice API
 * intermittently answers a valid token with 401 "Insufficient authorization"
 * after ~5 s (seen on 3 of 8 identical requests on 2026-11-05) and succeeds
 * on the next try. A truly bad token still fails every attempt and ends as
 * OandaAuthError.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500 || isAuthStatus(status);
}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "errorMessage" in body) {
      const message = (body as { errorMessage: unknown }).errorMessage;
      if (typeof message === "string") return message;
    }
  } catch {
    // Body was not JSON; fall through.
  }
  return response.statusText || "Unknown error";
}

export function createOandaClient(config: OandaClientConfig): OandaClient {
  const doFetch = config.fetch ?? fetch;
  const sleep = config.sleep ?? defaultSleep;
  const log = config.logger ?? jsonLogger;
  const now = config.now ?? Date.now;
  const baseUrl = OANDA_BASE_URLS[config.env];

  async function requestPage(
    pair: Pair,
    timeframe: Timeframe,
    params: Record<string, string>,
  ): Promise<ReturnType<typeof parseCandlesResponse>> {
    const query = new URLSearchParams({
      granularity: timeframe,
      price: "M",
      dailyAlignment: String(DAY_START_HOUR_NY),
      alignmentTimezone: MARKET_TIME_ZONE,
      ...params,
    });
    const url = `${baseUrl}/v3/instruments/${pair}/candles?${query.toString()}`;

    for (let attempt = 1; ; attempt++) {
      const started = now();
      let status: number | undefined;
      try {
        const response = await doFetch(url, {
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Accept-Datetime-Format": "RFC3339",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        status = response.status;

        if (!response.ok) {
          const message = await readErrorMessage(response);
          throw new OandaError(`OANDA request failed (HTTP ${status}): ${message}`, status);
        }

        const page = parseCandlesResponse(await response.json());
        log({ component: "oanda", pair, timeframe, count: page.candles.length, ms: now() - started, outcome: "ok", status, attempt });
        return page;
      } catch (error) {
        const retryable =
          error instanceof OandaError
            ? error.status !== undefined && isRetryableStatus(error.status)
            : !(error instanceof ZodError); // network/timeout errors retry; bad data does not
        const canRetry = retryable && attempt < MAX_ATTEMPTS;
        log({
          component: "oanda",
          pair,
          timeframe,
          ms: now() - started,
          outcome: canRetry ? "retry" : "error",
          status,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!canRetry) {
          if (error instanceof OandaError && error.status !== undefined && isAuthStatus(error.status)) {
            throw new OandaAuthError(error.status, attempt);
          }
          if (error instanceof OandaError) throw error;
          throw new OandaError(
            `OANDA request for ${pair} ${timeframe} failed after ${attempt} attempt(s): ${
              error instanceof Error ? error.message : String(error)
            }`,
            status,
          );
        }
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }

  async function fetchLatest(pair: Pair, timeframe: Timeframe, count: number): Promise<Candle[]> {
    if (!Number.isInteger(count) || count < 1 || count >= MAX_CANDLES_PER_REQUEST) {
      throw new RangeError(`count must be an integer from 1 to ${MAX_CANDLES_PER_REQUEST - 1}`);
    }
    // Ask for one extra: the newest candle is usually still forming and is dropped.
    const page = await requestPage(pair, timeframe, { count: String(count + 1) });
    return page.candles.slice(-count);
  }

  async function fetchRange(pair: Pair, timeframe: Timeframe, from: Date, to: Date): Promise<Candle[]> {
    if (!(from < to)) throw new RangeError("from must be before to");
    const byTime = new Map<string, Candle>();
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    let cursor = fromIso;
    let includeFirst = true;

    for (;;) {
      const page = await requestPage(pair, timeframe, {
        from: cursor,
        count: String(MAX_CANDLES_PER_REQUEST),
        includeFirst: String(includeFirst),
      });
      for (const candle of page.candles) {
        if (candle.time >= fromIso && candle.time < toIso) byTime.set(candle.time, candle);
      }
      // Never use the page size to detect the end: with includeFirst=false
      // OANDA counts the skipped cursor candle, so full pages hold 4999.
      const last = page.candles.at(-1);
      const done =
        page.reachedPresent || // hit the forming candle
        last === undefined || // nothing more (e.g. market closed since)
        last.time >= toIso || // covered the range
        last.time <= cursor; // no progress (defensive)
      if (done) break;
      cursor = last.time;
      includeFirst = false;
    }

    return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
  }

  return {
    fetchCandles(pair, timeframe, opts) {
      if ("count" in opts) return fetchLatest(pair, timeframe, opts.count);
      return fetchRange(pair, timeframe, opts.from, opts.to ?? new Date(now()));
    },
  };
}
