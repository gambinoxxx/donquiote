// News storage for the worker: an interface, the Prisma version and an
// in-memory version for tests.
import { getDb } from "@/lib/db/client";
import type { PushOutcome, PushTarget } from "@/lib/notify/push";
import { pairCurrencies, type CalendarEventInput, type Classification, type HeadlineInput, type HeadlineLite, type NewsEventLite } from "@/lib/news/types";
import type { Pair } from "@/lib/types";

export interface NewsPushContext {
  pushEnabled: boolean;
  newsPushCalendar: boolean;
  newsPushHeadlines: boolean;
  /** Currencies of enabled watchlist pairs. */
  watchedCurrencies: string[];
}

export type StoredHeadline = HeadlineInput & Classification;

export interface NewsStore {
  /** Inserts new events, updates changed ones (actual, forecast…). */
  upsertEvents(events: readonly CalendarEventInput[]): Promise<{ created: number; updated: number }>;
  /** Removes future, un-notified events of `source` in [from, to] the feed no longer lists (moved or cancelled). */
  deleteMissingEvents(source: string, fromIso: string, toIso: string, keepExternalIds: readonly string[], nowIso: string): Promise<number>;
  loadEvents(fromIso: string, toIso: string): Promise<NewsEventLite[]>;
  /** Sets notifiedAt where still null; returns how many were claimed. */
  claimEvents(ids: readonly string[], atIso: string): Promise<number>;
  existingHeadlineIds(externalIds: readonly string[]): Promise<Set<string>>;
  recentHeadlineTitles(sinceIso: string): Promise<string[]>;
  insertHeadline(h: StoredHeadline): Promise<boolean>;
  loadHeadlines(sinceIso: string): Promise<HeadlineLite[]>;
  lastHeadlinePushAt(): Promise<string | null>;
  claimHeadlines(ids: readonly string[], atIso: string): Promise<number>;
  countAiSince(sinceIso: string): Promise<number>;
  loadPushContext(): Promise<NewsPushContext>;
  loadPushTargets(): Promise<PushTarget[]>;
  applyPushOutcomes(outcomes: readonly PushOutcome[], atIso: string): Promise<void>;
  deleteNewsBefore(cutoffIso: string): Promise<number>;
  writeNewsStatus(status: string, atIso: string): Promise<void>;
}

const watched = (pairs: readonly Pair[]) => [...new Set(pairs.flatMap(pairCurrencies))];

export class PrismaNewsStore implements NewsStore {
  constructor(
    private readonly push: { loadPushTargets(): Promise<PushTarget[]>; applyPushOutcomes(o: readonly PushOutcome[], at: string): Promise<void> },
    private readonly db = getDb(),
  ) {}

  async upsertEvents(events: readonly CalendarEventInput[]) {
    if (events.length === 0) return { created: 0, updated: 0 };
    const existing = await this.db.newsEvent.findMany({ where: { externalId: { in: events.map((e) => e.externalId) } } });
    const byId = new Map(existing.map((e) => [e.externalId, e]));
    let created = 0;
    let updated = 0;
    const fresh = events.filter((e) => !byId.has(e.externalId));
    if (fresh.length > 0) {
      const r = await this.db.newsEvent.createMany({ data: fresh.map((e) => ({ ...e, time: new Date(e.time) })), skipDuplicates: true });
      created = r.count;
    }
    for (const e of events) {
      const old = byId.get(e.externalId);
      if (!old) continue;
      if (old.forecast !== e.forecast || old.previous !== e.previous || (e.actual !== null && old.actual !== e.actual)) {
        await this.db.newsEvent.update({
          where: { id: old.id },
          data: { forecast: e.forecast, previous: e.previous, ...(e.actual !== null && { actual: e.actual }) },
        });
        updated++;
      }
    }
    return { created, updated };
  }

  async deleteMissingEvents(source: string, fromIso: string, toIso: string, keep: readonly string[], nowIso: string) {
    const from = new Date(Math.max(Date.parse(fromIso), Date.parse(nowIso)));
    const { count } = await this.db.newsEvent.deleteMany({
      where: { source, time: { gte: from, lte: new Date(toIso) }, notifiedAt: null, externalId: { notIn: [...keep] } },
    });
    return count;
  }

  async loadEvents(fromIso: string, toIso: string) {
    const rows = await this.db.newsEvent.findMany({
      where: { impact: "HIGH", time: { gte: new Date(fromIso), lte: new Date(toIso) } },
      orderBy: { time: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      currency: r.currency,
      title: r.title,
      time: r.time.toISOString(),
      forecast: r.forecast,
      previous: r.previous,
      actual: r.actual,
      notifiedAt: r.notifiedAt ? r.notifiedAt.toISOString() : null,
    }));
  }

  async claimEvents(ids: readonly string[], atIso: string) {
    const { count } = await this.db.newsEvent.updateMany({ where: { id: { in: [...ids] }, notifiedAt: null }, data: { notifiedAt: new Date(atIso) } });
    return count;
  }

  async existingHeadlineIds(externalIds: readonly string[]) {
    const rows = await this.db.headline.findMany({ where: { externalId: { in: [...externalIds] } }, select: { externalId: true } });
    return new Set(rows.map((r) => r.externalId));
  }

  async recentHeadlineTitles(sinceIso: string) {
    const rows = await this.db.headline.findMany({ where: { publishedAt: { gte: new Date(sinceIso) } }, select: { title: true } });
    return rows.map((r) => r.title);
  }

  async insertHeadline(h: StoredHeadline) {
    const { count } = await this.db.headline.createMany({
      data: [
        {
          source: h.source,
          externalId: h.externalId,
          title: h.title,
          url: h.url,
          publishedAt: new Date(h.publishedAt),
          impact: h.impact,
          currencies: h.currencies,
          reason: h.reason,
          classifiedBy: h.classifiedBy,
        },
      ],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async loadHeadlines(sinceIso: string) {
    const rows = await this.db.headline.findMany({ where: { publishedAt: { gte: new Date(sinceIso) } }, orderBy: { publishedAt: "desc" } });
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      url: r.url,
      publishedAt: r.publishedAt.toISOString(),
      impact: r.impact,
      currencies: r.currencies,
      notifiedAt: r.notifiedAt ? r.notifiedAt.toISOString() : null,
    }));
  }

  async lastHeadlinePushAt() {
    const r = await this.db.headline.aggregate({ _max: { notifiedAt: true } });
    return r._max.notifiedAt ? r._max.notifiedAt.toISOString() : null;
  }

  async claimHeadlines(ids: readonly string[], atIso: string) {
    const { count } = await this.db.headline.updateMany({ where: { id: { in: [...ids] }, notifiedAt: null }, data: { notifiedAt: new Date(atIso) } });
    return count;
  }

  async countAiSince(sinceIso: string) {
    return this.db.headline.count({ where: { classifiedBy: "AI", createdAt: { gte: new Date(sinceIso) } } });
  }

  async loadPushContext() {
    const [s, pairs] = await Promise.all([
      this.db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { pushEnabled: true, newsPushCalendar: true, newsPushHeadlines: true } }),
      this.db.watchlistPair.findMany({ where: { enabled: true }, select: { pair: true } }),
    ]);
    return { ...s, watchedCurrencies: watched(pairs.map((p) => p.pair)) };
  }

  loadPushTargets() {
    return this.push.loadPushTargets();
  }

  applyPushOutcomes(outcomes: readonly PushOutcome[], atIso: string) {
    return this.push.applyPushOutcomes(outcomes, atIso);
  }

  async deleteNewsBefore(cutoffIso: string) {
    const cutoff = new Date(cutoffIso);
    const [e, h] = await this.db.$transaction([
      this.db.newsEvent.deleteMany({ where: { time: { lt: cutoff } } }),
      this.db.headline.deleteMany({ where: { publishedAt: { lt: cutoff } } }),
    ]);
    return e.count + h.count;
  }

  async writeNewsStatus(status: string, atIso: string) {
    const data = { newsStatus: status.slice(0, 500), newsCheckedAt: new Date(atIso) };
    await this.db.workerHeartbeat.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  }
}

// --- In memory (tests) ----------------------------------------------------------

interface MemEvent extends NewsEventLite {
  source: string;
  externalId: string;
}
interface MemHeadline extends HeadlineLite {
  externalId: string;
  classifiedBy: "KEYWORDS" | "AI";
  reason: string;
  createdAt: string;
}

export class MemoryNewsStore implements NewsStore {
  events: MemEvent[] = [];
  headlines: MemHeadline[] = [];
  targets: PushTarget[] = [];
  status: string | null = null;
  ctx: NewsPushContext = { pushEnabled: true, newsPushCalendar: true, newsPushHeadlines: true, watchedCurrencies: ["USD", "EUR", "GBP", "JPY", "CAD", "CHF"] };
  private seq = 0;
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async upsertEvents(events: readonly CalendarEventInput[]) {
    let created = 0;
    let updated = 0;
    for (const e of events) {
      const old = this.events.find((x) => x.externalId === e.externalId);
      if (!old) {
        this.events.push({ id: `e${++this.seq}`, source: e.source, externalId: e.externalId, currency: e.currency, title: e.title, time: e.time, forecast: e.forecast, previous: e.previous, actual: e.actual, notifiedAt: null });
        created++;
      } else if (old.forecast !== e.forecast || old.previous !== e.previous || (e.actual !== null && old.actual !== e.actual)) {
        Object.assign(old, { forecast: e.forecast, previous: e.previous, ...(e.actual !== null && { actual: e.actual }) });
        updated++;
      }
    }
    return { created, updated };
  }
  async deleteMissingEvents(source: string, fromIso: string, toIso: string, keep: readonly string[], nowIso: string) {
    const from = Math.max(Date.parse(fromIso), Date.parse(nowIso));
    const before = this.events.length;
    this.events = this.events.filter((e) => {
      const t = Date.parse(e.time);
      return !(e.source === source && t >= from && t <= Date.parse(toIso) && e.notifiedAt === null && !keep.includes(e.externalId));
    });
    return before - this.events.length;
  }
  async loadEvents(fromIso: string, toIso: string) {
    return this.events.filter((e) => e.time >= fromIso && e.time <= toIso).map((e) => ({ ...e }));
  }
  async claimEvents(ids: readonly string[], atIso: string) {
    let n = 0;
    for (const e of this.events) {
      if (ids.includes(e.id) && e.notifiedAt === null) {
        e.notifiedAt = atIso;
        n++;
      }
    }
    return n;
  }
  async existingHeadlineIds(ids: readonly string[]) {
    return new Set(this.headlines.filter((h) => ids.includes(h.externalId)).map((h) => h.externalId));
  }
  async recentHeadlineTitles(sinceIso: string) {
    return this.headlines.filter((h) => h.publishedAt >= sinceIso).map((h) => h.title);
  }
  async insertHeadline(h: StoredHeadline) {
    if (this.headlines.some((x) => x.externalId === h.externalId)) return false;
    this.headlines.push({
      id: `h${++this.seq}`,
      source: h.source,
      externalId: h.externalId,
      title: h.title,
      url: h.url,
      publishedAt: h.publishedAt,
      impact: h.impact,
      currencies: h.currencies,
      notifiedAt: null,
      classifiedBy: h.classifiedBy,
      reason: h.reason,
      createdAt: this.clock().toISOString(),
    });
    return true;
  }
  async loadHeadlines(sinceIso: string) {
    return this.headlines.filter((h) => h.publishedAt >= sinceIso).map((h) => ({ ...h }));
  }
  async lastHeadlinePushAt() {
    const all = this.headlines.map((h) => h.notifiedAt).filter((x): x is string => x !== null).sort();
    return all.at(-1) ?? null;
  }
  async claimHeadlines(ids: readonly string[], atIso: string) {
    let n = 0;
    for (const h of this.headlines) {
      if (ids.includes(h.id) && h.notifiedAt === null) {
        h.notifiedAt = atIso;
        n++;
      }
    }
    return n;
  }
  async countAiSince(sinceIso: string) {
    return this.headlines.filter((h) => h.classifiedBy === "AI" && h.createdAt >= sinceIso).length;
  }
  async loadPushContext() {
    return { ...this.ctx };
  }
  async loadPushTargets() {
    return this.targets;
  }
  async applyPushOutcomes() {}
  async deleteNewsBefore(cutoffIso: string) {
    const before = this.events.length + this.headlines.length;
    this.events = this.events.filter((e) => e.time >= cutoffIso);
    this.headlines = this.headlines.filter((h) => h.publishedAt >= cutoffIso);
    return before - this.events.length - this.headlines.length;
  }
  async writeNewsStatus(status: string) {
    this.status = status;
  }
}
