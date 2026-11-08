// News windows (pure): the Home banner and the warning on an alert.
// Warn only — nothing here changes strategies, alerts or the risk guard.
import type { Pair } from "@/lib/types";
import { pairCurrencies, type HeadlineLite, type NewsEventLite } from "./types";

const MIN = 60_000;
/** Alert warning: red calendar news this close to the alert (either side). */
export const ALERT_EVENT_WINDOW_MIN = 30;
/** Alert warning / banner: a HIGH headline this recent. */
export const HEADLINE_WINDOW_MIN = 15;

export type NewsBanner =
  | { kind: "event"; title: string; detail: string; minutes: number; events: NewsEventLite[] }
  | { kind: "headline"; title: string; detail: string; minutes: number; headline: HeadlineLite };

/** "in 25 min", "now", "3 min ago". */
export function relativeMinutes(minutes: number): string {
  if (minutes === 0) return "now";
  return minutes > 0 ? `in ${minutes} min` : `${-minutes} min ago`;
}

export const eventLabel = (e: Pick<NewsEventLite, "currency" | "title">) => `${e.currency} ${e.title}`;

/**
 * The red banner: red calendar news still to come within `warnMinutes`
 * (future events only), else a HIGH headline from the last 15 minutes,
 * else nothing. `pairsFor(currency)` lists the watchlist pairs it moves.
 */
export function newsBanner(args: {
  events: readonly NewsEventLite[];
  headlines: readonly HeadlineLite[];
  now: Date;
  warnMinutes: number;
  pairsFor: (currency: string) => string[];
}): NewsBanner | null {
  const now = args.now.getTime();
  const near = args.events
    .filter((e) => {
      const t = Date.parse(e.time);
      return t > now && t <= now + args.warnMinutes * MIN;
    })
    .sort((a, b) => a.time.localeCompare(b.time));
  if (near.length > 0) {
    const first = near[0]!;
    const sameTime = near.filter((e) => e.time === first.time);
    const minutes = Math.max(1, Math.round((Date.parse(first.time) - now) / MIN));
    const name = sameTime.length > 1 ? `${eventLabel(first)} +${sameTime.length - 1} more` : eventLabel(first);
    const pairs = [...new Set(sameTime.flatMap((e) => args.pairsFor(e.currency)))];
    return {
      kind: "event",
      title: `${name} in ${minutes} min`,
      detail: `${pairs.length > 0 ? `Moves ${pairs.join(", ")}. ` : ""}Spreads widen. New alerts get a news warning.`,
      minutes,
      events: sameTime,
    };
  }
  const recent = args.headlines
    .filter((h) => h.impact === "HIGH" && Date.parse(h.publishedAt) <= now && Date.parse(h.publishedAt) >= now - HEADLINE_WINDOW_MIN * MIN)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const h = recent[0];
  if (!h) return null;
  const minutes = Math.round((now - Date.parse(h.publishedAt)) / MIN);
  return {
    kind: "headline",
    title: `High-impact headline ${minutes === 0 ? "just now" : `${minutes} min ago`}`,
    detail: `${h.title}${h.currencies.length > 0 ? ` · ${h.currencies.join(", ")}` : ""}`,
    minutes,
    headline: h,
  };
}

export type AlertNewsWarning =
  | { kind: "event"; event: NewsEventLite; minutesFromAlert: number; text: string; short: string }
  | { kind: "headline"; headline: HeadlineLite; minutesBeforeAlert: number; text: string; short: string };

/**
 * The news warning for an alert at `time` on `pair`: red news within ±30
 * minutes on either of the pair's currencies (the closest one), or a HIGH
 * headline affecting them in the 15 minutes before it.
 */
export function alertNewsWarning(args: {
  pair: Pair;
  /** ISO: when the alert became Ready (or its sweep time). */
  time: string;
  events: readonly NewsEventLite[];
  headlines: readonly HeadlineLite[];
}): AlertNewsWarning | null {
  const at = Date.parse(args.time);
  const currencies: string[] = pairCurrencies(args.pair);
  const events = args.events
    .filter((e) => currencies.includes(e.currency) && Math.abs(Date.parse(e.time) - at) <= ALERT_EVENT_WINDOW_MIN * MIN)
    .sort((a, b) => Math.abs(Date.parse(a.time) - at) - Math.abs(Date.parse(b.time) - at));
  const e = events[0];
  if (e) {
    const minutes = Math.round((Date.parse(e.time) - at) / MIN);
    const name = eventLabel(e);
    const when = minutes > 0 ? `${minutes} min after this alert` : minutes < 0 ? `${-minutes} min before this alert` : "at the time of this alert";
    return {
      kind: "event",
      event: e,
      minutesFromAlert: minutes,
      text: `${name} ${when}. News can move price fast.`,
      short: `⚠ ${name} ${minutes > 0 ? `in ${minutes} min` : minutes < 0 ? `${-minutes} min ago` : "now"}`,
    };
  }
  const heads = args.headlines
    .filter((h) => {
      const t = Date.parse(h.publishedAt);
      return h.impact === "HIGH" && h.currencies.some((c) => currencies.includes(c)) && t <= at && t >= at - HEADLINE_WINDOW_MIN * MIN;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const h = heads[0];
  if (!h) return null;
  const minutes = Math.round((at - Date.parse(h.publishedAt)) / MIN);
  const title = h.title.length > 70 ? `${h.title.slice(0, 67)}…` : h.title;
  return {
    kind: "headline",
    headline: h,
    minutesBeforeAlert: minutes,
    text: `High-impact headline ${minutes} min before this alert: "${title}". News can move price fast.`,
    short: `⚠ High headline ${minutes} min ago: ${title}`,
  };
}
