// News sources (worker only). Each is an adapter behind one interface:
// - CalendarProvider: Forex Factory weekly JSON, this week + next week
//   (unofficial: ≤ every 30 min; next week's file is often 404 until late in
//   the week, which is not an error)
// - HeadlineProvider: Finnhub market news (needs FINNHUB_API_KEY), Federal
//   Reserve press releases RSS, White House news + presidential actions RSS
// Requests send a plain User-Agent and use ETag / Last-Modified so an
// unchanged feed costs a 304. Keys never appear in logs or errors.
import { parseForexFactory } from "@/lib/news/calendar";
import { parseRss, rssDate } from "@/lib/news/rss";
import type { CalendarEventInput, HeadlineInput, HeadlineSource } from "@/lib/news/types";

export const USER_AGENT = "DonquixoteFX/1.0 (private, non-commercial)";
export const FETCH_TIMEOUT_MS = 15_000;

export interface CalendarProvider {
  readonly id: string;
  /** null = unchanged since the last fetch (304). */
  fetchEvents(): Promise<CalendarEventInput[] | null>;
}

export interface HeadlineProvider {
  readonly id: HeadlineSource;
  /** null = unchanged since the last fetch (304). */
  fetchHeadlines(): Promise<HeadlineInput[] | null>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** GET with a timeout and conditional-request caching. The URL is never put in errors (it may hold a key). */
export class CachedFetcher {
  private etag: string | null = null;
  private lastModified: string | null = null;
  constructor(
    private readonly label: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /**
   * The body, or null when unchanged (304). With `missingOk`, a 404 returns
   * "" (no data yet) instead of throwing.
   */
  async get(url: string, opts: { missingOk?: boolean } = {}): Promise<string | null> {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "*/*" };
    if (this.etag) headers["If-None-Match"] = this.etag;
    if (this.lastModified) headers["If-Modified-Since"] = this.lastModified;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
    } catch (error) {
      const name = error instanceof Error ? error.name : "error";
      throw new Error(`${this.label}: request failed (${name === "TimeoutError" ? "timeout" : name})`);
    }
    if (res.status === 304) return null;
    if (res.status === 404 && opts.missingOk) {
      this.etag = null;
      this.lastModified = null;
      return "";
    }
    if (!res.ok) throw new Error(`${this.label}: HTTP ${res.status}`);
    const body = await res.text();
    this.etag = res.headers.get("etag");
    this.lastModified = res.headers.get("last-modified");
    return body;
  }
}

export const FOREX_FACTORY_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
export const FOREX_FACTORY_NEXT_WEEK_URL = "https://nfs.faireconomy.media/ff_calendar_nextweek.json";

function parseFeed(label: string, body: string): CalendarEventInput[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`${label}: not JSON (rate limited?)`);
  }
  return parseForexFactory(json);
}

/**
 * This week's and next week's feeds, merged. Each feed keeps its own ETag
 * and its last parsed events, so one changed feed still returns both weeks.
 * Next week missing (404) = no events for it; this week missing is an error.
 * Returns null only when both are unchanged.
 */
export function forexFactoryProvider(fetchImpl?: FetchLike): CalendarProvider {
  const feeds = [
    { url: FOREX_FACTORY_URL, fetcher: new CachedFetcher("forexfactory", fetchImpl), missingOk: false, events: [] as CalendarEventInput[] },
    { url: FOREX_FACTORY_NEXT_WEEK_URL, fetcher: new CachedFetcher("forexfactory next week", fetchImpl), missingOk: true, events: [] as CalendarEventInput[] },
  ];
  return {
    id: "forexfactory",
    async fetchEvents() {
      let changed = false;
      for (const feed of feeds) {
        const body = await feed.fetcher.get(feed.url, { missingOk: feed.missingOk });
        if (body === null) continue;
        changed = true;
        feed.events = body === "" ? [] : parseFeed("forexfactory", body);
      }
      if (!changed) return null;
      const byId = new Map<string, CalendarEventInput>();
      for (const e of feeds.flatMap((f) => f.events)) byId.set(e.externalId, e);
      return [...byId.values()].sort((a, b) => a.time.localeCompare(b.time) || a.currency.localeCompare(b.currency));
    },
  };
}

function rssProvider(id: HeadlineSource, urls: readonly string[], fetchImpl?: FetchLike): HeadlineProvider {
  const fetchers = urls.map((u, i) => ({ url: u, f: new CachedFetcher(`${id}#${i + 1}`, fetchImpl) }));
  return {
    id,
    async fetchHeadlines() {
      const out: HeadlineInput[] = [];
      let changed = false;
      for (const { url, f } of fetchers) {
        const xml = await f.get(url);
        if (xml === null) continue;
        changed = true;
        for (const item of parseRss(xml).slice(0, 40)) {
          const publishedAt = rssDate(item.pubDate);
          if (!publishedAt) continue;
          out.push({ source: id, externalId: `${id}:${item.guid}`.slice(0, 500), title: item.title.slice(0, 500), url: item.link, publishedAt, category: item.category });
        }
      }
      return changed ? out : null;
    },
  };
}

export const FED_RSS = ["https://www.federalreserve.gov/feeds/press_all.xml"];
export const WHITE_HOUSE_RSS = ["https://www.whitehouse.gov/news/feed/", "https://www.whitehouse.gov/presidential-actions/feed/"];

export const fedProvider = (fetchImpl?: FetchLike) => rssProvider("fed", FED_RSS, fetchImpl);
export const whiteHouseProvider = (fetchImpl?: FetchLike) => rssProvider("whitehouse", WHITE_HOUSE_RSS, fetchImpl);

interface FinnhubItem {
  id?: number;
  headline?: string;
  url?: string;
  datetime?: number;
  source?: string;
}

/** Finnhub market news, categories forex + general. The key goes in a header, not the URL. */
export function finnhubProvider(apiKey: string, fetchImpl: FetchLike = fetch): HeadlineProvider {
  return {
    id: "finnhub",
    async fetchHeadlines() {
      const out: HeadlineInput[] = [];
      for (const category of ["forex", "general"]) {
        let res: Response;
        try {
          res = await fetchImpl(`https://finnhub.io/api/v1/news?category=${category}`, {
            headers: { "User-Agent": USER_AGENT, "X-Finnhub-Token": apiKey },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
        } catch (error) {
          throw new Error(`finnhub: request failed (${error instanceof Error ? error.name : "error"})`);
        }
        if (!res.ok) throw new Error(`finnhub: HTTP ${res.status}`);
        const items = (await res.json()) as FinnhubItem[];
        if (!Array.isArray(items)) throw new Error("finnhub: unexpected response");
        for (const n of items.slice(0, 60)) {
          if (!n.id || !n.headline || !n.url || !n.datetime) continue;
          out.push({
            source: "finnhub",
            externalId: `finnhub:${n.id}`,
            title: n.headline.slice(0, 500),
            url: n.url,
            publishedAt: new Date(n.datetime * 1000).toISOString(),
            category: n.source ?? null,
          });
        }
      }
      return out;
    },
  };
}
