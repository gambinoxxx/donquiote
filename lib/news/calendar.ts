// Calendar parsing (pure). Forex Factory's weekly JSON feed
// (nfs.faireconomy.media/ff_calendar_thisweek.json): unofficial, so it is
// polled at most every 30 minutes and cached with ETag (worker/news).
import { isNewsCurrency, type CalendarEventInput } from "./types";

export const FOREX_FACTORY = "forexfactory";

interface FfRow {
  title?: unknown;
  country?: unknown;
  date?: unknown;
  impact?: unknown;
  forecast?: unknown;
  previous?: unknown;
  actual?: unknown;
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * Keeps High-impact events for the six currencies. `date` carries its UTC
 * offset (New York time), so the stored time is exact UTC. The id is the
 * currency + title + UTC time (the feed has no id of its own).
 */
export function parseForexFactory(json: unknown): CalendarEventInput[] {
  if (!Array.isArray(json)) throw new Error("calendar feed: expected a JSON array");
  const out: CalendarEventInput[] = [];
  const seen = new Set<string>();
  for (const raw of json as FfRow[]) {
    if (!raw || typeof raw !== "object") continue;
    const currency = text(raw.country);
    const title = text(raw.title);
    const date = text(raw.date);
    if (raw.impact !== "High" || !currency || !isNewsCurrency(currency) || !title || !date) continue;
    const ms = Date.parse(date);
    if (!Number.isFinite(ms)) continue;
    const time = new Date(ms).toISOString();
    const externalId = `${FOREX_FACTORY}:${currency}:${title}:${time}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    out.push({
      source: FOREX_FACTORY,
      externalId,
      currency,
      title,
      impact: "HIGH",
      time,
      forecast: text(raw.forecast),
      previous: text(raw.previous),
      actual: text(raw.actual),
    });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.currency.localeCompare(b.currency));
}

/** "0.3%" → 0.3, "65K" → 65000, "-68.3K" → -68300, "7-0-2" → null. */
export function parseFigure(value: string | null): number | null {
  if (!value) return null;
  const m = /^([<>]?)(-?\d+(?:\.\d+)?)\s*([KMBT%]?)$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[2]);
  const mult: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return n * (mult[(m[3] ?? "").toUpperCase()] ?? 1);
}

/** Actual vs forecast: "above" | "below" | "inline" | null (no numbers). */
export function actualVsForecast(actual: string | null, forecast: string | null): "above" | "below" | "inline" | null {
  const a = parseFigure(actual);
  const f = parseFigure(forecast);
  if (a === null || f === null) return null;
  if (Math.abs(a - f) < 1e-9) return "inline";
  return a > f ? "above" : "below";
}
