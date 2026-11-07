// Pure forex market-time helpers. All inputs and outputs are UTC `Date`s;
// New York wall-clock time is derived with Intl, so DST is handled by the
// time-zone database, never by a fixed offset.
import type { Timeframe } from "@/lib/types";

export const MARKET_TIME_ZONE = "America/New_York";
/** OANDA dailyAlignment: the forex day starts at 17:00 New York. */
export const DAY_START_HOUR_NY = 17;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  M15: 15 * MINUTE_MS,
  H4: 4 * HOUR_MS,
  D: DAY_MS,
};

/**
 * Number of candles in `hours` of market time, e.g. 72 h = 288 M15 candles
 * (the paper trade time limit; weekends have no candles, so they don't count).
 */
export function hoursToCandles(hours: number, timeframe: Timeframe): number {
  return Math.round((hours * HOUR_MS) / TIMEFRAME_MS[timeframe]);
}

const SUNDAY = 0;
const FRIDAY = 5;
const SATURDAY = 6;

const nyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/**
 * New York wall-clock time of `date`, encoded as if it were UTC
 * ("wall ms"). Lets us do calendar arithmetic in New York time with plain
 * Date.UTC maths.
 */
function toNyWallMs(date: Date): number {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of nyFormatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = parts;
  return Date.UTC(year, month - 1, day, hour, minute, second) + date.getUTCMilliseconds();
}

/**
 * Converts a New York wall time ("wall ms") back to a real UTC Date.
 * In the repeated hour when clocks go back, the earlier instant is used;
 * a wall time skipped when clocks go forward maps to just after the jump.
 */
function fromNyWallMs(wallMs: number): Date {
  // Offset = wall - real. Try both candidate offsets around the guess and
  // keep the earliest instant whose wall time matches.
  const firstGuess = wallMs - (toNyWallMs(new Date(wallMs)) - wallMs);
  const candidates = [-HOUR_MS, 0, HOUR_MS]
    .map((shift) => firstGuess + shift)
    .filter((t) => toNyWallMs(new Date(t)) === wallMs)
    .sort((a, b) => a - b);
  return new Date(candidates[0] ?? firstGuess);
}

/** Day of week (0 = Sunday) and hour of a New York wall time. */
function wallWeekdayHour(wallMs: number): { weekday: number; hour: number } {
  const d = new Date(wallMs);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
}

/** True from Sunday 17:00 to Friday 17:00 New York time. */
export function isMarketOpen(now: Date): boolean {
  const { weekday, hour } = wallWeekdayHour(toNyWallMs(now));
  if (weekday === SATURDAY) return false;
  if (weekday === SUNDAY) return hour >= DAY_START_HOUR_NY;
  if (weekday === FRIDAY) return hour < DAY_START_HOUR_NY;
  return true;
}

/** The most recent weekly close (Friday 17:00 New York) at or before `wallMs`. */
function lastFridayCloseWall(wallMs: number): number {
  const d = new Date(wallMs);
  const daysBack = (d.getUTCDay() - FRIDAY + 7) % 7;
  const friday = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - daysBack,
    DAY_START_HOUR_NY,
  );
  return friday <= wallMs ? friday : friday - 7 * DAY_MS;
}

/** Open (wall ms) of the H4 or D candle containing `wallMs`. */
function floorToCandleWall(timeframe: "H4" | "D", wallMs: number): number {
  const size = TIMEFRAME_MS[timeframe];
  const anchor = DAY_START_HOUR_NY * HOUR_MS; // candles are aligned to 17:00
  return Math.floor((wallMs - anchor) / size) * size + anchor;
}

/**
 * Open (UTC) of the forex day that contains `at`: the latest 17:00 New
 * York at or before it. During the week this is the open of the forming
 * daily candle; on Monday it is Sunday 17:00 NY. DST-safe.
 */
export function forexDayOpen(at: Date): Date {
  return fromNyWallMs(floorToCandleWall("D", toNyWallMs(at)));
}

/** Open time of the last closed candle, ignoring the weekend. */
function lastClosedIgnoringWeekend(timeframe: Timeframe, now: Date): Date {
  if (timeframe === "M15") {
    // NY offsets are whole hours, so 15-minute boundaries are the same in UTC.
    const size = TIMEFRAME_MS.M15;
    return new Date(Math.floor(now.getTime() / size) * size - size);
  }
  const currentOpen = floorToCandleWall(timeframe, toNyWallMs(now));
  return fromNyWallMs(currentOpen - TIMEFRAME_MS[timeframe]);
}

/**
 * Open time (UTC) of the most recent fully closed candle at `now`, using
 * OANDA's alignment: daily candles open at 17:00 New York and H4 candles
 * are aligned to the same day start (17, 21, 1, 5, 9, 13 NY). Candles that
 * would fall inside the weekend close are skipped, so on a weekend (or in
 * the first minutes after the Sunday open) this returns the last candle
 * before Friday's close.
 */
export function lastClosedCandleOpen(timeframe: Timeframe, now: Date): Date {
  const candidate = lastClosedIgnoringWeekend(timeframe, now);
  if (isMarketOpen(candidate)) return candidate;
  const fridayClose = fromNyWallMs(lastFridayCloseWall(toNyWallMs(candidate)));
  return lastClosedIgnoringWeekend(timeframe, fridayClose);
}
