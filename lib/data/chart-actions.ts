"use server";

// Chart server actions: older history when scrolling back, and new closed
// candles (plus fresh levels) every minute while the page is open.
import { z } from "zod";
import { requireAllowedUser } from "@/lib/auth";
import { getCandles, getChartContext } from "./chart";
import type { CandlePage, ChartContext } from "./types";

const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"] as const;
const base = z.object({
  pair: z.enum(PAIRS),
  timeframe: z.enum(["D", "H4", "M15"]),
});
const seconds = z.number().int().positive();

/** The 500 closed candles before `before` (UTC seconds), oldest first. */
export async function loadOlderCandles(input: unknown): Promise<CandlePage> {
  await requireAllowedUser();
  const { pair, timeframe, before } = base.extend({ before: seconds }).parse(input);
  return getCandles(pair, timeframe, { before });
}

/** Closed candles after `after` and the refreshed overlays for `from`–`to`. */
export async function refreshChart(input: unknown): Promise<{ candles: CandlePage; context: ChartContext }> {
  await requireAllowedUser();
  const { pair, timeframe, after, from, alertId } = base
    .extend({ after: seconds, from: seconds, alertId: z.string().max(64).optional() })
    .parse(input);
  const [candles, context] = await Promise.all([
    getCandles(pair, timeframe, { after }),
    getChartContext(pair, timeframe, { from, alertId }),
  ]);
  return { candles, context };
}
