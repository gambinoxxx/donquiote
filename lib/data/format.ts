// Display formatting shared by every screen (server and client components).
// Pure: no I/O. All times are shown in Africa/Lagos.
import type { Pair } from "@/lib/types";
import { priceDecimals } from "@/lib/market/pip";

export const DISPLAY_TIME_ZONE = "Africa/Lagos";
const DAY_MS = 24 * 3_600_000;

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(format: Intl.DateTimeFormat, date: Date): Record<string, string> {
  return Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]));
}

/** "Wed 4 Nov · 10:42" in Lagos time. */
export function formatDateTime(iso: string): string {
  const p = parts(dateTimeFormat, new Date(iso));
  return `${p.weekday} ${p.day} ${p.month} · ${p.hour}:${p.minute}`;
}

/** "Wed, 4 Nov" in Lagos time (page eyebrows). */
export function formatDay(iso: string): string {
  const p = parts(dateFormat, new Date(iso));
  return `${p.weekday}, ${p.day} ${p.month}`;
}

/** "10:42" in Lagos time. */
export function formatClock(iso: string): string {
  const p = parts(clockFormat, new Date(iso));
  return `${p.hour}:${p.minute}`;
}

/**
 * The one time label used in lists: within the last 24 hours relative
 * ("just now", "12 min ago", "3 h ago", "3 h 20 min ago"), otherwise the
 * Lagos date and time ("Wed 4 Nov · 10:42"). Future times (clock skew)
 * read "just now".
 */
export function formatWhen(iso: string, now: Date): string {
  const ageMs = now.getTime() - Date.parse(iso);
  if (ageMs >= DAY_MS) return formatDateTime(iso);
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h ago` : `${h} h ${m} min ago`;
}

/** "EUR/USD" */
export const pairLabel = (pair: Pair) => pair.replace("_", "/");

/** Decimals a pair's prices are quoted in (5, or 3 for JPY). */
export const pairDecimals = (pair: Pair) => priceDecimals(pair);

/** Price at the pair's precision: 5 decimals, 3 for JPY. */
export const formatPrice = (pair: Pair, value: number) => value.toFixed(priceDecimals(pair));

const minus = "−";
/** "+3R", "−1R", "+0.68R" (whole numbers without decimals). */
export function formatR(r: number): string {
  const abs = Math.abs(r);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${r < 0 ? minus : "+"}${text}R`;
}

/** "+$150", "−$50", "+$34.50". */
export function formatUsd(usd: number, options: { sign?: boolean } = { sign: true }): string {
  const abs = Math.abs(usd);
  const text = Number.isInteger(abs) ? abs.toLocaleString("en-US") : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (options.sign === false) return `$${text}`;
  return `${usd < 0 ? minus : "+"}$${text}`;
}

/** "3h 15m", "45m", "2d 4h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// --- Chart labels (Lightweight Charts gives UTC seconds) --------------------

const chartDayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TIME_ZONE, day: "numeric", month: "short" });
const chartMonthFormat = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TIME_ZONE, month: "short" });
const chartYearFormat = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TIME_ZONE, year: "numeric" });

/** Crosshair label: "Wed 4 Nov · 10:42" (intraday) or "Wed, 4 Nov" (daily). */
export function formatChartTime(utcSeconds: number, timeframe: "D" | "H4" | "M15"): string {
  const iso = new Date(utcSeconds * 1000).toISOString();
  return timeframe === "D" ? formatDay(iso) : formatDateTime(iso);
}

/**
 * Time-axis tick in Lagos time. `kind`: 0 year, 1 month, 2 day of month,
 * 3 time, 4 time with seconds (Lightweight Charts TickMarkType).
 */
export function formatChartTick(utcSeconds: number, kind: number): string {
  const date = new Date(utcSeconds * 1000);
  if (kind === 0) return chartYearFormat.format(date);
  if (kind === 1) return chartMonthFormat.format(date);
  if (kind === 2) return chartDayFormat.format(date);
  return formatClock(date.toISOString());
}

/** Time (UTC seconds) of the bar that contains `iso` (for markers on D / 4H bars). */
export function barTimeFor(iso: string, barTimes: readonly number[]): number | null {
  const t = Math.floor(Date.parse(iso) / 1000);
  let lo = 0;
  let hi = barTimes.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = barTimes[mid] as number;
    if (v <= t) {
      found = v;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
