// Headline classification (pure). Keyword rules first; only when they are
// unsure, and only if an AI classifier is configured, the title (nothing
// else) goes to a small model, at most AI_DAILY_CAP times a UTC day. Any AI
// failure or timeout falls back to NORMAL.
import { NEWS_CURRENCIES, type Classification, type HeadlineSource, type NewsCurrency } from "./types";

export const AI_DAILY_CAP = 200;
export const AI_TIMEOUT_MS = 8_000;

export type KeywordVerdict =
  | { impact: "HIGH"; currencies: NewsCurrency[]; reason: string }
  | { impact: "NORMAL"; reason: string }
  | { impact: "UNSURE"; currencies: NewsCurrency[]; reason: string };

/** Words that tie a headline to a currency. */
const CURRENCY_WORDS: Record<NewsCurrency, RegExp> = {
  USD: /\b(fed|fomc|federal reserve|powell|u\.?s\.?|united states|america(n)?|dollar|greenback|treasury|white house|trump|washington|wall street|bessent)\b/,
  EUR: /\b(ecb|european central bank|lagarde|euro|eurozone|euro area|eu|european union|germany|german|france|french|italy|brussels)\b/,
  GBP: /\b(boe|bank of england|bailey|sterling|pound|uk|u\.k\.|britain|british|england)\b/,
  JPY: /\b(boj|bank of japan|ueda|yen|japan|japanese|tokyo)\b/,
  CAD: /\b(boc|bank of canada|macklem|canada|canadian|loonie|ottawa)\b/,
  CHF: /\b(snb|swiss national bank|schlegel|franc|swiss|switzerland)\b/,
};

const TRUMP_WH = /\b(trump|white house|oval office|potus)\b/;
const WH_TOPIC =
  /\b(tariffs?|sanctions?|fed|federal reserve|powell|rates?|interest rates?|dollar|china|chinese|beijing|xi jinping|executive orders?|trade( deal| war| talks| policy)?)\b/;

const CENTRAL_BANK = /\b(fed|fomc|federal reserve|ecb|european central bank|boe|bank of england|boj|bank of japan|boc|bank of canada|snb|swiss national bank)\b/;
const RATE_DECISION =
  /\b(rate decision|policy decision|fomc statement|monetary policy statement|(raises?|cuts?|hikes?|lowers?|holds?|keeps?|leaves?|lifts?|slashes|maintains?) (its |key |the |benchmark |policy |interest )*(interest )?rates?|rate (cut|hike|increase|decrease|rise)s?|basis points?|bps\b|keeps policy|holds policy)/;
const EMERGENCY = /\b(emergency|unscheduled|surprise) (meeting|statement|cut|hike|action|rate|liquidity)/;
const INTERVENTION = /\bintervention|intervene[sd]?|intervening\b/;
const FX_CONTEXT = /\b(yen|currency|currencies|fx|forex|exchange rate|franc|dollar|mof|ministry of finance|boj|snb|katayama|kato|mimura)\b/;
const SHUTDOWN = /\b(government shutdown|shutdown of the (u\.?s\.? |federal )?government|government shuts down|federal shutdown)\b/;
const DEFAULT =
  /\b((debt|sovereign|treasury|bond|government|u\.?s\.?) default|default(s|ed)? on (its |their )?(debt|bonds?|payments?|obligations)|debt ceiling)\b/;

const WH_PR = /^ (?:\[[^\]]*\] )?(what they are saying|icymi|in case you missed it|myth vs\.? fact|week in review|[^:]{0,40} (was|is) right\b|[^:]{0,40} delivers?\b)/;

/** Market words: a headline with one of these but no HIGH rule is "unsure". */
const MARKET =
  /\b(fed|fomc|federal reserve|ecb|boe|boj|boc|snb|central bank|powell|lagarde|bailey|ueda|macklem|tariffs?|sanctions?|inflation|cpi|jobs report|payrolls|gdp|recession|treasury|yields?|rates?|dollar|yen|euro|sterling|franc|trump|white house|executive order|trade war|trade deal|stimulus|budget|deficit)\b/;

function currenciesIn(t: string): NewsCurrency[] {
  return NEWS_CURRENCIES.filter((c) => CURRENCY_WORDS[c].test(t));
}

const withUsd = (list: NewsCurrency[]): NewsCurrency[] => (list.includes("USD") ? list : ["USD", ...list]);

function cbCurrencies(t: string): NewsCurrency[] {
  const out: NewsCurrency[] = [];
  if (/\b(fed|fomc|federal reserve)\b/.test(t)) out.push("USD");
  if (/\b(ecb|european central bank)\b/.test(t)) out.push("EUR");
  if (/\b(boe|bank of england)\b/.test(t)) out.push("GBP");
  if (/\b(boj|bank of japan)\b/.test(t)) out.push("JPY");
  if (/\b(boc|bank of canada)\b/.test(t)) out.push("CAD");
  if (/\b(snb|swiss national bank)\b/.test(t)) out.push("CHF");
  return out;
}

const merge = (...lists: NewsCurrency[][]): NewsCurrency[] => NEWS_CURRENCIES.filter((c) => lists.some((l) => l.includes(c)));

/**
 * The keyword rules. `source` lets official White House items count as
 * "the White House" without the title saying so; Fed press releases that
 * are not monetary policy (enforcement, bank applications…) are NORMAL.
 */
export function classifyByKeywords(title: string, opts: { source?: HeadlineSource; category?: string | null } = {}): KeywordVerdict {
  const t = ` ${title.toLowerCase().replace(/[’']/g, "'")} `;
  const found = currenciesIn(t);
  const fromWh = opts.source === "whitehouse";
  // White House press roundups and opinion pieces are not actions.
  if (fromWh && WH_PR.test(t)) return { impact: "NORMAL", reason: "White House press roundup" };

  if ((TRUMP_WH.test(t) || fromWh) && WH_TOPIC.test(t)) {
    return { impact: "HIGH", currencies: withUsd(found), reason: "Trump / White House on tariffs, trade, the Fed, rates, the dollar or China" };
  }
  if (CENTRAL_BANK.test(t) && (RATE_DECISION.test(t) || EMERGENCY.test(t))) {
    const cb = cbCurrencies(t);
    return {
      impact: "HIGH",
      currencies: cb.length > 0 ? cb : found,
      reason: EMERGENCY.test(t) ? "Central bank emergency action or statement" : "Central bank rate decision",
    };
  }
  if (INTERVENTION.test(t) && FX_CONTEXT.test(t)) {
    const cur = found.length > 0 ? found : (["JPY"] as NewsCurrency[]);
    return { impact: "HIGH", currencies: merge(cur, /\byen\b/.test(t) ? ["USD", "JPY"] : []), reason: "Currency intervention" };
  }
  if (SHUTDOWN.test(t)) return { impact: "HIGH", currencies: found.length > 0 ? found : ["USD"], reason: "Government shutdown" };
  if (DEFAULT.test(t)) return { impact: "HIGH", currencies: found.length > 0 ? found : ["USD"], reason: "Debt default risk" };

  if (opts.source === "fed" && opts.category && !/monetary policy/i.test(opts.category)) {
    return { impact: "NORMAL", reason: `Fed press release (${opts.category})` };
  }
  if (MARKET.test(t) || (fromWh && found.length > 0)) {
    return { impact: "UNSURE", currencies: found, reason: "Mentions markets, but no High rule matched" };
  }
  return { impact: "NORMAL", reason: "No market-moving keywords" };
}

/** The AI fallback: title in, verdict out (or null on any failure). */
export interface AiClassifier {
  classify(title: string): Promise<{ impact: "HIGH" | "NORMAL"; currencies: string[]; reason: string } | null>;
}

/** Counts AI calls per UTC day and stops at the cap. */
export class AiBudget {
  private day = "";
  private used = 0;
  constructor(
    readonly cap = AI_DAILY_CAP,
    /** Calls already made today (e.g. counted from the database at start). */
    usedToday = 0,
    now = new Date(),
  ) {
    this.day = now.toISOString().slice(0, 10);
    this.used = usedToday;
  }
  /** Takes one call from today's budget; false when the cap is reached. */
  take(now: Date): boolean {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.cap) return false;
    this.used++;
    return true;
  }
  get usedToday(): number {
    return this.used;
  }
}

/** Rejects after `ms`. */
function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Keywords, then (if unsure) the AI within budget, else NORMAL. */
export async function classifyHeadline(
  title: string,
  opts: {
    source?: HeadlineSource;
    category?: string | null;
    ai?: AiClassifier | null;
    budget?: AiBudget | null;
    now?: Date;
    timeoutMs?: number;
  } = {},
): Promise<Classification> {
  const k = classifyByKeywords(title, opts);
  if (k.impact === "HIGH") return { impact: "HIGH", currencies: k.currencies, reason: k.reason, classifiedBy: "KEYWORDS" };
  if (k.impact === "NORMAL") return { impact: "NORMAL", currencies: [], reason: k.reason, classifiedBy: "KEYWORDS" };

  const fallback: Classification = { impact: "NORMAL", currencies: k.currencies, reason: k.reason, classifiedBy: "KEYWORDS" };
  if (!opts.ai || !opts.budget || !opts.budget.take(opts.now ?? new Date())) return fallback;
  try {
    const r = await timeout(opts.ai.classify(title), opts.timeoutMs ?? AI_TIMEOUT_MS);
    if (!r) return fallback;
    const currencies = NEWS_CURRENCIES.filter((c) => r.currencies.map((x) => x.toUpperCase()).includes(c));
    return {
      impact: r.impact === "HIGH" ? "HIGH" : "NORMAL",
      currencies: r.impact === "HIGH" && currencies.length === 0 ? k.currencies : currencies,
      reason: r.reason.slice(0, 200) || "AI",
      classifiedBy: "AI",
    };
  } catch {
    return fallback;
  }
}
