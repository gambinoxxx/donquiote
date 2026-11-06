// When the worker runs: ~10 s after every 15-minute close, only while the
// market is open. Pure timing helpers + a sequential loop (never two
// cycles at once).
import { isMarketOpen, TIMEFRAME_MS } from "@/lib/market/time";
import { describeError, type Logger } from "./log";

/** Delay after each quarter-hour close, so OANDA has marked the candle complete. */
export const RUN_DELAY_MS = 10_000;
const QUARTER_MS = TIMEFRAME_MS.M15;
/** Longest search window (covers any weekend or holiday close). */
const MAX_LOOKAHEAD_MS = 8 * 24 * 3_600_000;

/**
 * True if the M15 candle that closes at `boundary` was inside market hours,
 * i.e. there is a fresh closed candle to process. Friday 17:00 NY → true
 * (last candle of the week); Sunday 17:00 NY → false (nothing closed yet).
 */
export function hasCandleClosingAt(boundary: Date): boolean {
  return isMarketOpen(new Date(boundary.getTime() - 1));
}

/** The next run time strictly after `now`: a quarter-hour + 10 s with a candle to process. */
export function nextRunAt(now: Date): Date {
  let boundary = Math.floor(now.getTime() / QUARTER_MS) * QUARTER_MS;
  if (boundary + RUN_DELAY_MS <= now.getTime()) boundary += QUARTER_MS;
  const limit = now.getTime() + MAX_LOOKAHEAD_MS;
  while (boundary <= limit) {
    if (hasCandleClosingAt(new Date(boundary))) return new Date(boundary + RUN_DELAY_MS);
    boundary += QUARTER_MS;
  }
  throw new Error(`No market open within 8 days of ${now.toISOString()}`);
}

/** Sleeps until `at`, in short chunks (robust to laptop sleep), or until aborted. */
export async function sleepUntil(at: Date, signal: AbortSignal): Promise<void> {
  const CHUNK_MS = 30_000;
  while (!signal.aborted) {
    const remaining = at.getTime() - Date.now();
    if (remaining <= 0) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.min(remaining, CHUNK_MS));
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

/**
 * Runs `cycle` at every scheduled time until `signal` aborts. A cycle always
 * finishes before the next is scheduled, and abort waits for it to finish.
 */
export async function runScheduler(args: {
  cycle: (now: Date) => Promise<unknown>;
  signal: AbortSignal;
  logger: Logger;
}): Promise<void> {
  const { cycle, signal, logger } = args;
  while (!signal.aborted) {
    const at = nextRunAt(new Date());
    const waitMin = Math.round((at.getTime() - Date.now()) / 60_000);
    logger({ component: "scheduler", outcome: "waiting", nextRunAt: at.toISOString(), waitMin });
    await sleepUntil(at, signal);
    if (signal.aborted) break;
    try {
      await cycle(new Date());
    } catch (error) {
      // runCycle handles its own errors; this is a last-resort guard.
      logger({
        component: "scheduler",
        outcome: "cycle_crashed",
        error: describeError(error),
      });
    }
  }
  logger({ component: "scheduler", outcome: "stopped" });
}
