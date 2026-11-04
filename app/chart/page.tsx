import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Chart" };

export default function ChartPage() {
  return (
    <>
      <PageHeader eyebrow="Your levels drawn for you" title="Chart" />
      <ComingSoon
        unit={10}
        description="Candlestick chart for any watchlist pair on D / 4H / 15m, with previous day high/low, equal highs/lows and trade levels."
      />
    </>
  );
}
