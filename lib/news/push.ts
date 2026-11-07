// News push planning (pure). Push only, never email; never touches alerts,
// strategies or the risk guard.
// - Red calendar event: one push 15 min before (sent once, `notifiedAt`),
//   only for currencies in an enabled watchlist pair.
// - HIGH headline: pushed at once, at most one push every 10 min; HIGH
//   headlines that arrive meanwhile are merged into the next one
//   ("+2 more"). Nothing older than 20 min is ever pushed.
import type { PushPayload } from "@/lib/notify/format";
import { eventLabel } from "./warnings";
import type { HeadlineLite, NewsEventLite } from "./types";

const MIN = 60_000;
export const CALENDAR_LEAD_MIN = 15;
export const HEADLINE_THROTTLE_MIN = 10;
export const HEADLINE_MAX_AGE_MIN = 20;

export interface CalendarPush {
  events: NewsEventLite[];
  payload: PushPayload;
}

/**
 * Events due now: release within the next 15 minutes (not yet released),
 * not notified, on a watched currency. Events at the same time are one push.
 */
export function planCalendarPushes(args: {
  events: readonly NewsEventLite[];
  now: Date;
  enabled: boolean;
  watchedCurrencies: readonly string[];
}): CalendarPush[] {
  if (!args.enabled) return [];
  const now = args.now.getTime();
  const due = args.events.filter((e) => {
    const t = Date.parse(e.time);
    return e.notifiedAt === null && args.watchedCurrencies.includes(e.currency) && t > now && t - now <= CALENDAR_LEAD_MIN * MIN;
  });
  const byTime = new Map<string, NewsEventLite[]>();
  for (const e of due) byTime.set(e.time, [...(byTime.get(e.time) ?? []), e]);
  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, events]) => {
      const first = events[0]!;
      const minutes = Math.max(1, Math.round((Date.parse(time) - now) / MIN));
      const name = events.length > 1 ? `${eventLabel(first)} +${events.length - 1} more` : eventLabel(first);
      const figures = [first.forecast && `Forecast ${first.forecast}`, first.previous && `Prev ${first.previous}`].filter(Boolean);
      return {
        events,
        payload: {
          title: `${name} in ${minutes} min`,
          body: [...figures, "Red news: spreads widen, price can jump."].join(" · "),
          url: "/news",
          tag: `news-cal-${time}`,
        },
      };
    });
}

export interface HeadlinePush {
  /** Every headline the push covers (all get `notifiedAt`). */
  headlines: HeadlineLite[];
  payload: PushPayload;
}

/**
 * One push for the newest pending HIGH headline (+N more), unless a
 * headline push went out less than 10 minutes ago.
 */
export function planHeadlinePush(args: {
  headlines: readonly HeadlineLite[];
  now: Date;
  enabled: boolean;
  /** ISO of the last headline push (latest notifiedAt), or null. */
  lastPushAt: string | null;
}): HeadlinePush | null {
  if (!args.enabled) return null;
  const now = args.now.getTime();
  if (args.lastPushAt && now - Date.parse(args.lastPushAt) < HEADLINE_THROTTLE_MIN * MIN) return null;
  const pending = args.headlines
    .filter((h) => {
      const t = Date.parse(h.publishedAt);
      return h.impact === "HIGH" && h.notifiedAt === null && t >= now - HEADLINE_MAX_AGE_MIN * MIN && t <= now + MIN;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const newest = pending[0];
  if (!newest) return null;
  const more = pending.length - 1;
  const currencies = [...new Set(pending.flatMap((h) => h.currencies))];
  return {
    headlines: pending,
    payload: {
      title: `High-impact news${currencies.length > 0 ? ` · ${currencies.join(", ")}` : ""}${more > 0 ? ` (+${more} more)` : ""}`,
      body: `${newest.title.length > 140 ? `${newest.title.slice(0, 137)}…` : newest.title} · Stay out or wait; don't chase it.`,
      url: "/news#headlines",
      tag: "news-headlines",
    },
  };
}
