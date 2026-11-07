// News (Unit 15): shared types. Pure; no network, no database.
import type { Pair } from "@/lib/types";

/** The currencies the app watches for red news. */
export const NEWS_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD", "CHF"] as const;
export type NewsCurrency = (typeof NEWS_CURRENCIES)[number];

export const isNewsCurrency = (c: string): c is NewsCurrency => (NEWS_CURRENCIES as readonly string[]).includes(c);

/** The news currencies in a pair (gold counts as USD). */
export function pairCurrencies(pair: Pair): NewsCurrency[] {
  return pair.split("_").filter(isNewsCurrency);
}

/** A calendar event as parsed from a provider (times in UTC ISO). */
export interface CalendarEventInput {
  source: string;
  externalId: string;
  currency: NewsCurrency;
  title: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  time: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
}

/** A headline as fetched from a provider, before classification. */
export interface HeadlineInput {
  source: HeadlineSource;
  externalId: string;
  title: string;
  url: string;
  /** ISO, UTC. */
  publishedAt: string;
  /** Provider category, if any (e.g. the Fed's "Monetary Policy"). */
  category?: string | null;
}

export type HeadlineSource = "finnhub" | "fed" | "whitehouse";

export const SOURCE_LABEL: Record<HeadlineSource, string> = {
  finnhub: "Headline feed",
  fed: "Federal Reserve · official",
  whitehouse: "White House · official",
};

export interface Classification {
  impact: "HIGH" | "NORMAL";
  currencies: NewsCurrency[];
  reason: string;
  classifiedBy: "KEYWORDS" | "AI";
}

/** What the warnings and pushes need from a stored event / headline. */
export interface NewsEventLite {
  id: string;
  currency: string;
  title: string;
  /** ISO, UTC. */
  time: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  notifiedAt: string | null;
}

export interface HeadlineLite {
  id: string;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
  impact: "HIGH" | "NORMAL";
  currencies: string[];
  notifiedAt: string | null;
}
