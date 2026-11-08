import { describe, expect, it, vi } from "vitest";
import { actualVsForecast, parseFigure, parseForexFactory } from "./calendar";
import { AiBudget, classifyByKeywords, classifyHeadline, type AiClassifier } from "./classify";
import { isNearDuplicate, titleSimilarity } from "./dedupe";
import { planCalendarPushes, planHeadlinePush } from "./push";
import { parseRss, rssDate } from "./rss";
import type { HeadlineLite, NewsEventLite } from "./types";
import { alertNewsWarning, newsBanner } from "./warnings";
import { pushPayload, emailContent, type NotifyContent } from "@/lib/notify/format";

const MIN = 60_000;
const NOW = new Date("2026-11-10T13:00:00.000Z");
const at = (min: number) => new Date(NOW.getTime() + min * MIN).toISOString();

const ev = (min: number, currency = "USD", title = "CPI m/m", extra: Partial<NewsEventLite> = {}): NewsEventLite => ({
  id: `${currency}-${title}-${min}`,
  currency,
  title,
  time: at(min),
  forecast: "0.3%",
  previous: "0.4%",
  actual: null,
  notifiedAt: null,
  ...extra,
});
const hl = (min: number, extra: Partial<HeadlineLite> = {}): HeadlineLite => ({
  id: `h${min}${extra.title ?? ""}`,
  source: "finnhub",
  title: "Example headline",
  url: "https://example.com/a",
  publishedAt: at(min),
  impact: "HIGH",
  currencies: ["USD"],
  notifiedAt: null,
  ...extra,
});

// --- Calendar ------------------------------------------------------------------

describe("calendar parsing (Forex Factory weekly JSON)", () => {
  const feed = [
    { title: "CPI m/m", country: "USD", date: "2026-11-10T08:30:00-05:00", impact: "High", forecast: "0.3%", previous: "0.4%" },
    { title: "Retail Sales m/m", country: "USD", date: "2026-11-10T08:30:00-05:00", impact: "Medium", forecast: "0.2%", previous: "0.1%" },
    { title: "Cash Rate", country: "AUD", date: "2026-11-02T22:30:00-05:00", impact: "High", forecast: "4.85%", previous: "4.60%" },
    { title: "Bank Holiday", country: "JPY", date: "2026-11-03T00:00:00-05:00", impact: "Holiday", forecast: "", previous: "" },
    { title: "Official Bank Rate", country: "GBP", date: "2026-11-05T07:00:00-05:00", impact: "High", forecast: "4.00%", previous: "3.75%", actual: "3.75%" },
    { title: "BOJ Gov Ueda Speaks", country: "JPY", date: "2026-11-06T11:00:00-05:00", impact: "High", forecast: "", previous: "" },
    { title: "CPI m/m", country: "USD", date: "2026-11-10T08:30:00-05:00", impact: "High", forecast: "0.3%", previous: "0.4%" },
    { title: "Broken", country: "EUR", date: "not a date", impact: "High" },
  ];

  it("keeps only High impact for the six currencies, once each", () => {
    const out = parseForexFactory(feed);
    expect(out.map((e) => `${e.currency} ${e.title}`)).toEqual(["GBP Official Bank Rate", "JPY BOJ Gov Ueda Speaks", "USD CPI m/m"]);
  });

  it("stores exact UTC times (the feed's offset is applied)", () => {
    const usd = parseForexFactory(feed).find((e) => e.currency === "USD")!;
    expect(usd.time).toBe("2026-11-10T13:30:00.000Z");
    expect(usd.externalId).toBe("forexfactory:USD:CPI m/m:2026-11-10T13:30:00.000Z");
  });

  it("empty strings become null; actual is kept when present", () => {
    const [gbp, jpy] = parseForexFactory(feed);
    expect(gbp!.actual).toBe("3.75%");
    expect(jpy).toMatchObject({ forecast: null, previous: null, actual: null });
  });

  it("rejects a non-array (e.g. an HTML rate-limit page parsed as JSON)", () => {
    expect(() => parseForexFactory({ error: "x" })).toThrow();
  });

  it("actual vs forecast", () => {
    expect(parseFigure("65K")).toBe(65_000);
    expect(parseFigure("-68.3K")).toBeCloseTo(-68_300);
    expect(parseFigure("7-0-2")).toBeNull();
    expect(actualVsForecast("0.4%", "0.3%")).toBe("above");
    expect(actualVsForecast("3.75%", "4.00%")).toBe("below");
    expect(actualVsForecast("4.2%", "4.2%")).toBe("inline");
    expect(actualVsForecast(null, "4.2%")).toBeNull();
  });
});

describe("RSS", () => {
  it("reads items with CDATA and entities", () => {
    const xml = `<rss><channel><title>x</title>
      <item><title>Fed &amp; ECB <![CDATA[ignored]]></title><link><![CDATA[https://f.gov/a.htm]]></link><guid>g1</guid><category>Monetary Policy</category><pubDate>Wed, 05 Nov 2026 19:00:00 GMT</pubDate></item>
      <item><title><![CDATA[Second &amp; item]]></title><link>https://f.gov/b</link><pubDate>Thu, 06 Nov 2026 21:56:55 +0000</pubDate></item>
    </channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ link: "https://f.gov/a.htm", guid: "g1", category: "Monetary Policy" });
    expect(items[1]!.guid).toBe("https://f.gov/b");
    expect(rssDate(items[1]!.pubDate)).toBe("2026-11-06T21:56:55.000Z");
  });
});

// --- Classification --------------------------------------------------------------

// TEST FIXTURES — invented example titles written for these tests. They are
// not real headlines or statements by anyone.
const HIGH_FIXTURES: Array<[string, string[], { source?: "whitehouse" | "fed" | "finnhub"; category?: string }?]> = [
  ["[Fixture] Trump announces 25% tariffs on Canadian imports", ["USD", "CAD"]],
  ["[Fixture] White House weighs new sanctions on Chinese banks", ["USD"]],
  ["[Fixture] Trump says Powell should cut rates now", ["USD"]],
  ["[Fixture] Trump: the dollar is too strong", ["USD"]],
  ["[Fixture] Trump signs executive order on trade with Japan", ["USD", "JPY"]],
  ["[Fixture] White House says China trade talks collapse", ["USD"]],
  ["[Fixture] Trump threatens tariffs on EU goods", ["USD", "EUR"]],
  ["[Fixture] Executive order imposing duties on steel", ["USD"], { source: "whitehouse" }],
  ["[Fixture] Fed cuts rates by 25 basis points", ["USD"]],
  ["[Fixture] FOMC statement: Federal Reserve holds rates steady", ["USD"]],
  ["[Fixture] ECB raises interest rates for the first time in a year", ["EUR"]],
  ["[Fixture] Bank of England cuts its key rate to 3.5%", ["GBP"]],
  ["[Fixture] BoJ hikes rates; yen jumps", ["JPY"]],
  ["[Fixture] Bank of Canada leaves rates unchanged... holds policy", ["CAD"]],
  ["[Fixture] SNB lowers interest rates to zero", ["CHF"]],
  ["[Fixture] Fed calls emergency meeting", ["USD"]],
  ["[Fixture] ECB issues emergency statement on bond markets", ["EUR"]],
  ["[Fixture] Japan confirms yen intervention by Ministry of Finance", ["USD", "JPY"]],
  ["[Fixture] SNB intervention in the franc suspected", ["CHF"]],
  ["[Fixture] US government shutdown begins at midnight", ["USD"]],
  ["[Fixture] Congress misses deal; risk of US default rises", ["USD"]],
  ["[Fixture] Treasury warns of debt ceiling breach next month", ["USD"]],
];
const NORMAL_FIXTURES: Array<[string, { source?: "whitehouse" | "fed" | "finnhub"; category?: string }?]> = [
  ["[Fixture] Apple unveils a new phone"],
  ["[Fixture] Football club signs a striker"],
  ["[Fixture] Federal Reserve Board announces termination of enforcement action", { source: "fed", category: "Enforcement Actions" }],
  ["[Fixture] What They Are Saying: tariffs are working", { source: "whitehouse" }],
  ["[Fixture] National Pickle Week, 2026", { source: "whitehouse" }],
  ["[Fixture] Company reports record quarterly profit"],
  ["[Fixture] Default settings changed in popular app"],
];
const UNSURE_FIXTURES = ["[Fixture] Inflation worries weigh on stocks", "[Fixture] Powell to speak at a conference next week", "[Fixture] Euro steadies ahead of data"];

describe("keyword rules (test fixtures, not real statements)", () => {
  it.each(HIGH_FIXTURES)("HIGH: %s", (title, currencies, opts) => {
    const v = classifyByKeywords(title, opts);
    expect(v.impact).toBe("HIGH");
    if (v.impact === "HIGH") expect([...v.currencies].sort()).toEqual([...currencies].sort());
  });
  it.each(NORMAL_FIXTURES)("NORMAL: %s", (title, opts) => {
    expect(classifyByKeywords(title, opts).impact).toBe("NORMAL");
  });
  it.each(UNSURE_FIXTURES)("UNSURE: %s", (title) => {
    expect(classifyByKeywords(title).impact).toBe("UNSURE");
  });
  it("has about 30 fixtures", () => {
    expect(HIGH_FIXTURES.length + NORMAL_FIXTURES.length + UNSURE_FIXTURES.length).toBeGreaterThanOrEqual(30);
  });
});

describe("AI fallback (mocked)", () => {
  const yes: AiClassifier = { classify: vi.fn(async () => ({ impact: "HIGH" as const, currencies: ["EUR", "XYZ"], reason: "Shock" })) };

  it("is only asked when the rules are unsure, with the title only", async () => {
    const ai: AiClassifier = { classify: vi.fn(async () => ({ impact: "HIGH" as const, currencies: ["eur"], reason: "Shock" })) };
    const budget = new AiBudget(200, 0, NOW);
    const high = await classifyHeadline("[Fixture] Fed cuts rates by 50 basis points", { ai, budget, now: NOW });
    expect(high.classifiedBy).toBe("KEYWORDS");
    const unsure = await classifyHeadline("[Fixture] Euro steadies ahead of data", { ai, budget, now: NOW });
    expect(unsure).toMatchObject({ impact: "HIGH", currencies: ["EUR"], classifiedBy: "AI" });
    expect(ai.classify).toHaveBeenCalledTimes(1);
    expect(ai.classify).toHaveBeenCalledWith("[Fixture] Euro steadies ahead of data");
  });

  it("stops at the daily cap and resets the next UTC day", async () => {
    const budget = new AiBudget(2, 0, NOW);
    const t = "[Fixture] Inflation worries weigh on stocks";
    const r = [];
    for (let i = 0; i < 3; i++) r.push(await classifyHeadline(t, { ai: yes, budget, now: NOW }));
    expect(r.map((x) => x.classifiedBy)).toEqual(["AI", "AI", "KEYWORDS"]);
    expect(r[2]!.impact).toBe("NORMAL");
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * MIN);
    expect((await classifyHeadline(t, { ai: yes, budget, now: tomorrow })).classifiedBy).toBe("AI");
  });

  it("counts calls already made today", () => {
    const budget = new AiBudget(200, 200, NOW);
    expect(budget.take(NOW)).toBe(false);
  });

  it("falls back to NORMAL on timeout or error", async () => {
    const slow: AiClassifier = { classify: () => new Promise((r) => setTimeout(() => r({ impact: "HIGH", currencies: [], reason: "late" }), 200)) };
    const broken: AiClassifier = { classify: async () => Promise.reject(new Error("HTTP 529")) };
    const t = "[Fixture] Inflation worries weigh on stocks";
    expect(await classifyHeadline(t, { ai: slow, budget: new AiBudget(), now: NOW, timeoutMs: 20 })).toMatchObject({ impact: "NORMAL", classifiedBy: "KEYWORDS" });
    expect(await classifyHeadline(t, { ai: broken, budget: new AiBudget(), now: NOW })).toMatchObject({ impact: "NORMAL", classifiedBy: "KEYWORDS" });
  });

  it("without a key (no classifier) unsure means NORMAL", async () => {
    expect(await classifyHeadline("[Fixture] Inflation worries weigh on stocks", { ai: null })).toMatchObject({ impact: "NORMAL" });
  });
});

describe("dedupe", () => {
  it("near-identical titles across sources", () => {
    expect(titleSimilarity("Fed cuts rates by 25 basis points", "Fed cuts rates by 25 basis points.")).toBe(1);
    expect(isNearDuplicate("Fed cuts rates by 25 basis points", ["The Fed cuts rates by 25 basis points"])).toBe(true);
    expect(isNearDuplicate("Fed cuts rates by 25 basis points", ["ECB cuts rates by 25 basis points"])).toBe(false);
  });
});

// --- Windows ---------------------------------------------------------------------

describe("Home banner", () => {
  const pairsFor = (c: string) => (c === "USD" ? ["EUR/USD", "USD/JPY"] : []);
  it("red news within the warn window (edges included)", () => {
    expect(newsBanner({ events: [ev(30)], headlines: [], now: NOW, warnMinutes: 30, pairsFor })?.title).toBe("USD CPI m/m in 30 min");
    expect(newsBanner({ events: [ev(31)], headlines: [], now: NOW, warnMinutes: 30, pairsFor })).toBeNull();
    const b = newsBanner({ events: [ev(10), ev(10, "USD", "Core CPI m/m")], headlines: [], now: NOW, warnMinutes: 30, pairsFor })!;
    expect(b.title).toBe("USD CPI m/m +1 more in 10 min");
    expect(b.detail).toContain("Moves EUR/USD, USD/JPY");
  });
  it("a HIGH headline in the last 15 min, only when no red news", () => {
    expect(newsBanner({ events: [], headlines: [hl(-15)], now: NOW, warnMinutes: 30, pairsFor })?.kind).toBe("headline");
    expect(newsBanner({ events: [], headlines: [hl(-16)], now: NOW, warnMinutes: 30, pairsFor })).toBeNull();
    expect(newsBanner({ events: [], headlines: [hl(-5, { impact: "NORMAL" })], now: NOW, warnMinutes: 30, pairsFor })).toBeNull();
    expect(newsBanner({ events: [ev(20)], headlines: [hl(-1)], now: NOW, warnMinutes: 30, pairsFor })?.kind).toBe("event");
  });
  it("future events only: released or past events never show", () => {
    expect(newsBanner({ events: [ev(0)], headlines: [], now: NOW, warnMinutes: 30, pairsFor })).toBeNull();
    expect(newsBanner({ events: [ev(-2)], headlines: [], now: NOW, warnMinutes: 30, pairsFor })).toBeNull();
    expect(newsBanner({ events: [ev(-60 * 24 * 2)], headlines: [], now: NOW, warnMinutes: 30, pairsFor })).toBeNull();
    expect(newsBanner({ events: [ev(-2), ev(25)], headlines: [], now: NOW, warnMinutes: 30, pairsFor })?.title).toBe("USD CPI m/m in 25 min");
  });
});

describe("alert news warning", () => {
  const base = { pair: "EUR_USD" as const, time: NOW.toISOString(), headlines: [] as HeadlineLite[] };
  it("red news within ±30 min on either currency", () => {
    expect(alertNewsWarning({ ...base, events: [ev(30)] })?.text).toBe("USD CPI m/m 30 min after this alert. News can move price fast.");
    expect(alertNewsWarning({ ...base, events: [ev(-30, "EUR", "German Prelim CPI")] })?.text).toContain("30 min before this alert");
    expect(alertNewsWarning({ ...base, events: [ev(31)] })).toBeNull();
    expect(alertNewsWarning({ ...base, events: [ev(-31)] })).toBeNull();
    expect(alertNewsWarning({ ...base, events: [ev(20)] })?.short).toBe("⚠ USD CPI m/m in 20 min");
  });
  it("only on the pair's currencies", () => {
    expect(alertNewsWarning({ ...base, events: [ev(5, "JPY", "BOJ Rate")] })).toBeNull();
    expect(alertNewsWarning({ ...base, pair: "USD_JPY", events: [ev(5, "JPY", "BOJ Rate")] })).not.toBeNull();
    expect(alertNewsWarning({ ...base, pair: "XAU_USD", events: [ev(5)] })).not.toBeNull();
  });
  it("a HIGH headline within the 15 min before the alert", () => {
    const events: NewsEventLite[] = [];
    expect(alertNewsWarning({ ...base, events, headlines: [hl(-15)] })?.kind).toBe("headline");
    expect(alertNewsWarning({ ...base, events, headlines: [hl(-16)] })).toBeNull();
    expect(alertNewsWarning({ ...base, events, headlines: [hl(1)] })).toBeNull();
    expect(alertNewsWarning({ ...base, events, headlines: [hl(-5, { currencies: ["CAD"] })] })).toBeNull();
    expect(alertNewsWarning({ ...base, events, headlines: [hl(-5, { impact: "NORMAL" })] })).toBeNull();
  });
});

// --- Pushes ----------------------------------------------------------------------

describe("calendar push", () => {
  const watched = ["USD", "EUR"];
  it("15 min before, for watched currencies, not after release, not twice", () => {
    expect(planCalendarPushes({ events: [ev(16)], now: NOW, enabled: true, watchedCurrencies: watched })).toHaveLength(0);
    const p = planCalendarPushes({ events: [ev(15)], now: NOW, enabled: true, watchedCurrencies: watched });
    expect(p[0]!.payload).toMatchObject({ title: "USD CPI m/m in 15 min", url: "/news" });
    expect(p[0]!.payload.body).toContain("Forecast 0.3% · Prev 0.4%");
    expect(planCalendarPushes({ events: [ev(0)], now: NOW, enabled: true, watchedCurrencies: watched })).toHaveLength(0);
    expect(planCalendarPushes({ events: [ev(-10)], now: NOW, enabled: true, watchedCurrencies: watched })).toHaveLength(0);
    expect(planCalendarPushes({ events: [ev(10, "USD", "CPI m/m", { notifiedAt: at(-5) })], now: NOW, enabled: true, watchedCurrencies: watched })).toHaveLength(0);
    expect(planCalendarPushes({ events: [ev(10, "JPY")], now: NOW, enabled: true, watchedCurrencies: watched })).toHaveLength(0);
  });
  it("events at the same time are one push; the toggle is respected", () => {
    const events = [ev(12), ev(12, "USD", "Core CPI m/m"), ev(14, "EUR", "ECB Rate")];
    const p = planCalendarPushes({ events, now: NOW, enabled: true, watchedCurrencies: watched });
    expect(p.map((x) => x.events.length)).toEqual([2, 1]);
    expect(p[0]!.payload.title).toBe("USD CPI m/m +1 more in 12 min");
    expect(planCalendarPushes({ events, now: NOW, enabled: false, watchedCurrencies: watched })).toEqual([]);
  });
});

describe("HIGH headline push", () => {
  it("throttled to one per 10 min, later ones merged (+N more)", () => {
    const heads = [hl(-1, { title: "B" }), hl(-3, { title: "A" }), hl(-2, { title: "C", impact: "NORMAL" })];
    expect(planHeadlinePush({ headlines: heads, now: NOW, enabled: true, lastPushAt: at(-9) })).toBeNull();
    const p = planHeadlinePush({ headlines: heads, now: NOW, enabled: true, lastPushAt: at(-10) })!;
    expect(p.headlines.map((h) => h.title)).toEqual(["B", "A"]);
    expect(p.payload.title).toBe("High-impact news · USD (+1 more)");
    expect(p.payload.body.startsWith("B")).toBe(true);
  });
  it("never pushes anything older than 20 min, or already pushed; toggle respected", () => {
    expect(planHeadlinePush({ headlines: [hl(-21)], now: NOW, enabled: true, lastPushAt: null })).toBeNull();
    expect(planHeadlinePush({ headlines: [hl(-20)], now: NOW, enabled: true, lastPushAt: null })).not.toBeNull();
    expect(planHeadlinePush({ headlines: [hl(-2, { notifiedAt: at(-1) })], now: NOW, enabled: true, lastPushAt: null })).toBeNull();
    expect(planHeadlinePush({ headlines: [hl(-2)], now: NOW, enabled: false, lastPushAt: null })).toBeNull();
  });
});

describe("alert push / email news line", () => {
  const c: NotifyContent = {
    id: "a1", pair: "EUR_USD", direction: "SELL", strategyIds: ["dg-v1"], entry: 1.1, stop: 1.102, target: 1.094, lotSize: 0.25, riskUsd: 50,
    sweepType: "PDH", sweepLevel: 1.101, bosLevel: 1.0995, entryType: "MARKET", readyAt: NOW.toISOString(), entryValidUntil: null,
  };
  it("adds one line only when there is a warning", () => {
    expect(pushPayload(c, "g").body).not.toContain("⚠");
    expect(pushPayload({ ...c, newsWarning: "⚠ USD CPI m/m in 20 min" }, "g").body).toContain("\n⚠ USD CPI m/m in 20 min");
    expect(emailContent({ ...c, newsWarning: "⚠ USD CPI m/m in 20 min" }, "http://x").text).toContain("News: ⚠ USD CPI m/m in 20 min");
  });
});
