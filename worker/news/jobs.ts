// News jobs (worker). Separate timers from the price cycle, in the same
// process and under the same lock. One tick a minute decides what is due:
// - calendar: every 30 min, plus once after 00:05 UTC
// - headlines: every 2 min while the market is open, every 5 min otherwise
// - pushes: every tick (15-min calendar reminders, throttled HIGH headlines)
// - retention: once a UTC day, news older than 30 days is deleted
// A failing source is logged and shown in the heartbeat's newsStatus; it
// never throws out of tick(), so it can't stop the price cycle.
import { isMarketOpen } from "@/lib/market/time";
import { AiBudget, classifyHeadline, type AiClassifier } from "@/lib/news/classify";
import { isNearDuplicate } from "@/lib/news/dedupe";
import { planCalendarPushes, planHeadlinePush, HEADLINE_MAX_AGE_MIN, CALENDAR_LEAD_MIN } from "@/lib/news/push";
import { sendPushToAll, type PushClient } from "@/lib/notify/push";
import type { PushPayload } from "@/lib/notify/format";
import { describeError, type Logger } from "../log";
import type { CalendarProvider, HeadlineProvider } from "./providers";
import type { NewsStore } from "./store";

const MIN = 60_000;
export const CALENDAR_EVERY_MIN = 30;
export const HEADLINES_OPEN_EVERY_MIN = 2;
export const HEADLINES_CLOSED_EVERY_MIN = 5;
export const RETENTION_DAYS = 30;
/** Only headlines this recent are stored on a first fetch. */
const MAX_HEADLINE_AGE_DAYS = 3;

export interface NewsRunnerDeps {
  store: NewsStore;
  calendar: CalendarProvider;
  headlines: readonly HeadlineProvider[];
  /** Sources switched off, e.g. "finnhub: off (no FINNHUB_API_KEY)". */
  skipped?: readonly string[];
  ai?: AiClassifier | null;
  push: { client: PushClient } | null;
  logger: Logger;
}

export interface TickReport {
  calendar: "ok" | "unchanged" | "error" | "not due";
  headlines: { stored: number; errors: number } | "not due";
  calendarPushes: number;
  headlinePushes: number;
  cleaned: number | null;
}

/** 00:05 UTC on the day of `now`. */
const dailyCalendarAt = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 5);

export class NewsRunner {
  private lastCalendarAt: number | null = null;
  private lastHeadlinesAt: number | null = null;
  private lastCleanupDay: string | null = null;
  private budget: AiBudget | null = null;
  private readonly status = new Map<string, string>();

  constructor(private readonly deps: NewsRunnerDeps) {
    for (const s of deps.skipped ?? []) this.status.set(s.split(":")[0]!, s);
  }

  calendarDue(now: Date): boolean {
    if (this.lastCalendarAt === null) return true;
    if (now.getTime() - this.lastCalendarAt >= CALENDAR_EVERY_MIN * MIN) return true;
    const daily = dailyCalendarAt(now);
    return now.getTime() >= daily && this.lastCalendarAt < daily;
  }

  headlinesDue(now: Date): boolean {
    if (this.lastHeadlinesAt === null) return true;
    const every = isMarketOpen(now) ? HEADLINES_OPEN_EVERY_MIN : HEADLINES_CLOSED_EVERY_MIN;
    return now.getTime() - this.lastHeadlinesAt >= every * MIN - 5_000;
  }

  /** Runs whatever is due. Never throws. */
  async tick(now: Date, opts: { force?: boolean } = {}): Promise<TickReport> {
    const report: TickReport = { calendar: "not due", headlines: "not due", calendarPushes: 0, headlinePushes: 0, cleaned: null };
    let ran = false;
    if (opts.force || this.calendarDue(now)) {
      report.calendar = await this.runCalendar(now);
      ran = true;
    }
    if (opts.force || this.headlinesDue(now)) {
      report.headlines = await this.runHeadlines(now);
      ran = true;
    }
    try {
      const pushed = await this.runPushes(now);
      report.calendarPushes = pushed.calendar;
      report.headlinePushes = pushed.headlines;
    } catch (error) {
      this.deps.logger({ component: "news", step: "push", outcome: "error", error: describeError(error) });
    }
    const day = now.toISOString().slice(0, 10);
    if (this.lastCleanupDay !== day) {
      try {
        report.cleaned = await this.deps.store.deleteNewsBefore(new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * MIN).toISOString());
        this.lastCleanupDay = day;
        this.deps.logger({ component: "news", step: "cleanup", outcome: "ok", deleted: report.cleaned });
      } catch (error) {
        this.deps.logger({ component: "news", step: "cleanup", outcome: "error", error: describeError(error) });
      }
    }
    if (ran) {
      await this.deps.store
        .writeNewsStatus(this.statusLine(), now.toISOString())
        .catch((error: unknown) => this.deps.logger({ component: "news", step: "status", outcome: "error", error: describeError(error) }));
    }
    return report;
  }

  /** "forexfactory ok · fed ok · whitehouse error: HTTP 503 · finnhub: off (no FINNHUB_API_KEY)". */
  statusLine(): string {
    return [...this.status.values()].join(" · ");
  }

  private async runCalendar(now: Date): Promise<TickReport["calendar"]> {
    const { calendar, store, logger } = this.deps;
    this.lastCalendarAt = now.getTime();
    try {
      const events = await calendar.fetchEvents();
      if (events === null) {
        this.status.set(calendar.id, `${calendar.id} ok`);
        logger({ component: "news", step: "calendar", source: calendar.id, outcome: "unchanged" });
        return "unchanged";
      }
      const { created, updated } = await store.upsertEvents(events);
      let removed = 0;
      if (events.length > 0) {
        removed = await store.deleteMissingEvents(calendar.id, events[0]!.time, events.at(-1)!.time, events.map((e) => e.externalId), now.toISOString());
      }
      this.status.set(calendar.id, `${calendar.id} ok`);
      logger({ component: "news", step: "calendar", source: calendar.id, outcome: "ok", events: events.length, created, updated, removed });
      return "ok";
    } catch (error) {
      this.status.set(calendar.id, `${calendar.id} error: ${describeError(error).slice(0, 80)}`);
      logger({ component: "news", step: "calendar", source: calendar.id, outcome: "error", error: describeError(error) });
      return "error";
    }
  }

  private async aiBudget(now: Date): Promise<AiBudget | null> {
    if (!this.deps.ai) return null;
    if (!this.budget) {
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const used = await this.deps.store.countAiSince(dayStart).catch(() => 0);
      this.budget = new AiBudget(undefined, used, now);
    }
    return this.budget;
  }

  private async runHeadlines(now: Date): Promise<{ stored: number; errors: number }> {
    const { store, logger } = this.deps;
    this.lastHeadlinesAt = now.getTime();
    let stored = 0;
    let errors = 0;
    for (const provider of this.deps.headlines) {
      try {
        const items = await provider.fetchHeadlines();
        if (items === null) {
          this.status.set(provider.id, `${provider.id} ok`);
          continue;
        }
        const minTime = new Date(now.getTime() - MAX_HEADLINE_AGE_DAYS * 24 * 60 * MIN).toISOString();
        const fresh = items.filter((i) => i.publishedAt >= minTime);
        const existing = await store.existingHeadlineIds(fresh.map((i) => i.externalId));
        const titles = await store.recentHeadlineTitles(new Date(now.getTime() - 24 * 60 * MIN).toISOString());
        const budget = await this.aiBudget(now);
        let added = 0;
        let duplicates = 0;
        for (const item of fresh.filter((i) => !existing.has(i.externalId)).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) {
          if (isNearDuplicate(item.title, titles)) {
            duplicates++;
            continue;
          }
          const c = await classifyHeadline(item.title, { source: item.source, category: item.category, ai: this.deps.ai, budget, now });
          if (await store.insertHeadline({ ...item, ...c })) {
            added++;
            titles.push(item.title);
            if (c.impact === "HIGH") logger({ component: "news", step: "headline", source: item.source, impact: "HIGH", by: c.classifiedBy, currencies: c.currencies.join(",") });
          }
        }
        stored += added;
        this.status.set(provider.id, `${provider.id} ok`);
        logger({ component: "news", step: "headlines", source: provider.id, outcome: "ok", fetched: items.length, added, duplicates });
      } catch (error) {
        errors++;
        this.status.set(provider.id, `${provider.id} error: ${describeError(error).slice(0, 80)}`);
        logger({ component: "news", step: "headlines", source: provider.id, outcome: "error", error: describeError(error) });
      }
    }
    return { stored, errors };
  }

  private async send(payload: PushPayload, atIso: string): Promise<number> {
    const push = this.deps.push;
    if (!push) return 0;
    const targets = await this.deps.store.loadPushTargets();
    if (targets.length === 0) return 0;
    const outcomes = await sendPushToAll(targets, payload, push.client);
    await this.deps.store.applyPushOutcomes(outcomes, atIso).catch(() => {});
    return outcomes.filter((o) => o.result === "ok").length;
  }

  private async runPushes(now: Date): Promise<{ calendar: number; headlines: number }> {
    const { store, logger } = this.deps;
    if (!this.deps.push) return { calendar: 0, headlines: 0 };
    const ctx = await store.loadPushContext();
    if (!ctx.pushEnabled || (!ctx.newsPushCalendar && !ctx.newsPushHeadlines)) return { calendar: 0, headlines: 0 };
    const at = now.toISOString();
    let calendar = 0;
    let headlines = 0;

    if (ctx.newsPushCalendar) {
      const events = await store.loadEvents(at, new Date(now.getTime() + (CALENDAR_LEAD_MIN + 1) * MIN).toISOString());
      for (const p of planCalendarPushes({ events, now, enabled: true, watchedCurrencies: ctx.watchedCurrencies })) {
        // Claim first: a crash after this never sends it twice.
        if ((await store.claimEvents(p.events.map((e) => e.id), at)) === 0) continue;
        const sent = await this.send(p.payload, at);
        calendar++;
        logger({ component: "news", step: "push", kind: "calendar", events: p.events.length, sent, outcome: sent > 0 ? "sent" : "no devices" });
      }
    }
    if (ctx.newsPushHeadlines) {
      const recent = await store.loadHeadlines(new Date(now.getTime() - HEADLINE_MAX_AGE_MIN * MIN).toISOString());
      const plan = planHeadlinePush({ headlines: recent, now, enabled: true, lastPushAt: await store.lastHeadlinePushAt() });
      if (plan && (await store.claimHeadlines(plan.headlines.map((h) => h.id), at)) > 0) {
        const sent = await this.send(plan.payload, at);
        headlines++;
        logger({ component: "news", step: "push", kind: "headline", merged: plan.headlines.length, sent, outcome: sent > 0 ? "sent" : "no devices" });
      }
    }
    return { calendar, headlines };
  }
}
