// News for the dashboard (Unit 15). Server-only. Reads NewsEvent / Headline
// (written by the worker) and Settings; never writes, and never feeds
// strategies, alerts or the risk guard.
import "server-only";
import { getDb } from "@/lib/db/client";
import { actualVsForecast } from "@/lib/news/calendar";
import { NEWS_CURRENCIES, pairCurrencies, SOURCE_LABEL, type HeadlineLite, type HeadlineSource, type NewsEventLite } from "@/lib/news/types";
import { ALERT_EVENT_WINDOW_MIN, HEADLINE_WINDOW_MIN, alertNewsWarning, newsBanner, type AlertNewsWarning, type NewsBanner } from "@/lib/news/warnings";
import type { Pair } from "@/lib/types";
import { DISPLAY_TIME_ZONE, pairLabel } from "./format";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Lagos is UTC+1 all year (no daylight saving). */
const LAGOS_OFFSET_MS = 60 * MIN;

export type NewsRange = "today" | "tomorrow" | "week";

export interface NewsEventView extends NewsEventLite {
  /** Actual vs forecast, once released. */
  vsForecast: "above" | "below" | "inline" | null;
}

export interface NewsDayGroup {
  /** "Today · Sat 7 Nov", "Tomorrow · Sun 8 Nov", "Mon 9 Nov". */
  label: string;
  /** Start of the Lagos day, UTC ms. */
  day: number;
  events: NewsEventView[];
}

/** The calendar as shown: upcoming days first, past days collapsed. */
export interface NewsCalendar {
  /** Today, Tomorrow, then later days in order (Lagos). */
  upcoming: NewsDayGroup[];
  /** Days before today, oldest first ("Earlier this week"). */
  earlier: NewsDayGroup[];
  /** Whether any event has an actual figure (the feed usually has none). */
  hasActuals: boolean;
}

export interface HeadlineView extends HeadlineLite {
  sourceLabel: string;
  reason: string | null;
}

export interface NewsPageData {
  now: string;
  banner: NewsBanner | null;
  calendar: NewsCalendar;
  headlines: HeadlineView[];
  /** HIGH headlines in the last 15 minutes (dot on the tab). */
  freshHigh: number;
  settings: { newsPushCalendar: boolean; newsPushHeadlines: boolean; newsWarnMinutes: number; pushEnabled: boolean };
  versionId: string | null;
  /** "forexfactory ok · fed ok · …" and when it was checked. */
  sources: { status: string | null; checkedAt: string | null };
}

/** Start of the Lagos day containing `t`, as UTC ms. */
export function lagosDayStart(t: number): number {
  return Math.floor((t + LAGOS_OFFSET_MS) / DAY) * DAY - LAGOS_OFFSET_MS;
}

/** How far ahead the calendar reaches: covers next week's feed from any day. */
export const CALENDAR_AHEAD_DAYS = 14;

/**
 * [from, to) for Today / Tomorrow / This week, in Lagos days. "This week"
 * runs from Monday (so this week's released events stay visible under
 * "Earlier this week") to 14 days after today, so next week's events show
 * on any day, Sunday included.
 */
export function newsRangeBounds(range: NewsRange, now: Date): { from: Date; to: Date } {
  const today = lagosDayStart(now.getTime());
  if (range === "today") return { from: new Date(today), to: new Date(today + DAY) };
  if (range === "tomorrow") return { from: new Date(today + DAY), to: new Date(today + 2 * DAY) };
  const weekday = new Date(today + LAGOS_OFFSET_MS).getUTCDay(); // 0 = Sunday
  const monday = today - ((weekday + 6) % 7) * DAY;
  return { from: new Date(monday), to: new Date(today + CALENDAR_AHEAD_DAYS * DAY) };
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TIME_ZONE, weekday: "short", day: "numeric", month: "short" });

export function groupByLagosDay(events: readonly NewsEventLite[], now: Date): NewsDayGroup[] {
  const today = lagosDayStart(now.getTime());
  const groups = new Map<number, NewsEventView[]>();
  for (const e of events) {
    const day = lagosDayStart(Date.parse(e.time));
    groups.set(day, [...(groups.get(day) ?? []), { ...e, vsForecast: e.actual ? actualVsForecast(e.actual, e.forecast) : null }]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, list]) => {
      const name = dayFormat.format(new Date(day + 12 * 3_600_000)).replace(",", "");
      const label = day === today ? `Today · ${name}` : day === today + DAY ? `Tomorrow · ${name}` : name;
      return { label, day, events: list.sort((a, b) => a.time.localeCompare(b.time) || a.currency.localeCompare(b.currency)) };
    });
}

/** Splits day groups into upcoming (today onward, in order) and earlier days. */
export function buildCalendar(events: readonly NewsEventLite[], now: Date): NewsCalendar {
  const today = lagosDayStart(now.getTime());
  const groups = groupByLagosDay(events, now);
  return {
    upcoming: groups.filter((g) => g.day >= today),
    earlier: groups.filter((g) => g.day < today),
    hasActuals: events.some((e) => e.actual !== null),
  };
}

function eventLite(r: { id: string; currency: string; title: string; time: Date; forecast: string | null; previous: string | null; actual: string | null; notifiedAt: Date | null }): NewsEventLite {
  return { id: r.id, currency: r.currency, title: r.title, time: r.time.toISOString(), forecast: r.forecast, previous: r.previous, actual: r.actual, notifiedAt: r.notifiedAt ? r.notifiedAt.toISOString() : null };
}

function headlineView(r: {
  id: string;
  source: string;
  title: string;
  url: string;
  publishedAt: Date;
  impact: "HIGH" | "NORMAL";
  currencies: string[];
  notifiedAt: Date | null;
  reason: string | null;
}): HeadlineView {
  return {
    id: r.id,
    source: r.source,
    sourceLabel: SOURCE_LABEL[r.source as HeadlineSource] ?? r.source,
    title: r.title,
    url: r.url,
    publishedAt: r.publishedAt.toISOString(),
    impact: r.impact,
    currencies: r.currencies,
    notifiedAt: r.notifiedAt ? r.notifiedAt.toISOString() : null,
    reason: r.reason,
  };
}

/** Red calendar events in the range, by Lagos day, upcoming first. */
export async function getNews({ range }: { range: NewsRange }, now = new Date()): Promise<NewsCalendar> {
  const { from, to } = newsRangeBounds(range, now);
  const rows = await getDb().newsEvent.findMany({ where: { impact: "HIGH", time: { gte: from, lt: to } }, orderBy: { time: "asc" } });
  return buildCalendar(rows.map(eventLite), now);
}

export async function getHeadlines({ highOnly, currency, limit = 60 }: { highOnly: boolean; currency?: string; limit?: number }): Promise<HeadlineView[]> {
  const rows = await getDb().headline.findMany({
    where: {
      ...(highOnly && { impact: "HIGH" }),
      ...(currency && (NEWS_CURRENCIES as readonly string[]).includes(currency) && { currencies: { has: currency } }),
    },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  return rows.map(headlineView);
}

/** Watchlist pairs (enabled) that a currency moves, as labels. */
async function pairsByCurrency(): Promise<(currency: string) => string[]> {
  const pairs = await getDb().watchlistPair.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" }, select: { pair: true } });
  return (c) => pairs.filter((p) => pairCurrencies(p.pair).includes(c as never)).map((p) => pairLabel(p.pair));
}

/** Red calendar news still to come within newsWarnMinutes, else a HIGH headline in the last 15 min, else null. */
export async function getNewsBanner(now = new Date()): Promise<NewsBanner | null> {
  const db = getDb();
  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { newsWarnMinutes: true } });
  const [events, headlines, pairsFor] = await Promise.all([
    db.newsEvent.findMany({
      where: { impact: "HIGH", time: { gt: now, lte: new Date(now.getTime() + settings.newsWarnMinutes * MIN) } },
    }),
    db.headline.findMany({ where: { impact: "HIGH", publishedAt: { gte: new Date(now.getTime() - HEADLINE_WINDOW_MIN * MIN) } } }),
    pairsByCurrency(),
  ]);
  return newsBanner({ events: events.map(eventLite), headlines: headlines.map(headlineView), now, warnMinutes: settings.newsWarnMinutes, pairsFor });
}

/** Red news within ±30 min of the alert, or a HIGH headline in the 15 min before it, on the pair's currencies. */
export async function getNewsWarningForAlert(alert: { pair: Pair; time: string }): Promise<AlertNewsWarning | null> {
  const at = Date.parse(alert.time);
  const currencies = pairCurrencies(alert.pair);
  const db = getDb();
  const [events, headlines] = await Promise.all([
    db.newsEvent.findMany({
      where: {
        impact: "HIGH",
        currency: { in: currencies },
        time: { gte: new Date(at - ALERT_EVENT_WINDOW_MIN * MIN), lte: new Date(at + ALERT_EVENT_WINDOW_MIN * MIN) },
      },
    }),
    db.headline.findMany({
      where: { impact: "HIGH", currencies: { hasSome: currencies }, publishedAt: { gte: new Date(at - HEADLINE_WINDOW_MIN * MIN), lte: new Date(at) } },
    }),
  ]);
  return alertNewsWarning({ pair: alert.pair, time: alert.time, events: events.map(eventLite), headlines: headlines.map(headlineView) });
}

export async function getNewsPage(now = new Date()): Promise<NewsPageData> {
  const db = getDb();
  const [banner, calendar, headlines, settings, version, heartbeat] = await Promise.all([
    getNewsBanner(now),
    getNews({ range: "week" }, now),
    getHeadlines({ highOnly: false, limit: 80 }),
    db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { newsPushCalendar: true, newsPushHeadlines: true, newsWarnMinutes: true, pushEnabled: true } }),
    db.settingsVersion.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }),
    db.workerHeartbeat.findUnique({ where: { id: 1 }, select: { newsStatus: true, newsCheckedAt: true } }),
  ]);
  return {
    now: now.toISOString(),
    banner,
    calendar,
    headlines,
    freshHigh: headlines.filter((h) => h.impact === "HIGH" && now.getTime() - Date.parse(h.publishedAt) <= HEADLINE_WINDOW_MIN * MIN).length,
    settings,
    versionId: version?.id ?? null,
    sources: { status: heartbeat?.newsStatus ?? null, checkedAt: heartbeat?.newsCheckedAt ? heartbeat.newsCheckedAt.toISOString() : null },
  };
}
