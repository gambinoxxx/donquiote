import type { Metadata } from "next";
import { connection } from "next/server";
import { ChartView } from "@/components/chart/chart-view";
import { PageHeader } from "@/components/page-header";
import { requireAllowedUser } from "@/lib/auth";
import { getCandles, getChartContext, getChartPairs, parsePair } from "@/lib/data";
import type { ChartTimeframe } from "@/lib/data/types";

export const metadata: Metadata = { title: "Chart" };

const TIMEFRAMES: readonly ChartTimeframe[] = ["D", "H4", "M15"];

export default async function ChartPage({ searchParams }: PageProps<"/chart">) {
  // Live candles: always render at request time.
  await connection();
  await requireAllowedUser();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

  const pairs = await getChartPairs();
  const pair = parsePair(one(params.pair)) ?? pairs.find((p) => p.enabled)?.pair ?? pairs[0]?.pair ?? "EUR_USD";
  const tfParam = one(params.tf);
  const timeframe: ChartTimeframe = TIMEFRAMES.includes(tfParam as ChartTimeframe) ? (tfParam as ChartTimeframe) : "M15";
  const alertId = one(params.alert);

  const candles = await getCandles(pair, timeframe);
  const context = await getChartContext(pair, timeframe, { from: candles.candles[0]?.time, alertId });
  return (
    <>
      <PageHeader eyebrow="Your levels drawn for you" title="Chart" />
      <ChartView
        key={`${pair}:${timeframe}:${alertId ?? ""}`}
        pairs={pairs.some((p) => p.pair === pair) ? pairs : [...pairs, { pair, enabled: false }]}
        pair={pair}
        timeframe={timeframe}
        alertId={alertId}
        initialCandles={candles}
        initialContext={context}
      />
    </>
  );
}
