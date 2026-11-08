"use client";

// Mini 15m chart for an alert: ~60 stored candles with entry, stop, target
// and the swept level. TradingView Lightweight Charts v5. Colours come from
// the CSS tokens (ui-context.md → Chart page), read at runtime.
import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { ChartCandle } from "@/lib/data/types";
import { registerChartCapture } from "@/components/ask-claude/capture";

export interface ChartLevel {
  price: number;
  label: string;
  kind: "entry" | "stop" | "target" | "sweep";
}

/** Lightweight Charts shows UTC; Lagos is UTC+1 all year (no DST), so shift for display. */
const LAGOS_OFFSET_S = 3600;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function MiniChart({
  candles,
  levels,
  decimals,
  label,
  captureId,
}: {
  /** Registers the chart's screenshot for Ask Claude under this id. */
  captureId?: string;
  candles: ChartCandle[];
  levels: ChartLevel[];
  decimals: number;
  /** Accessible description of what the chart shows. */
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (!el || candles.length === 0) return;
    const colors = {
      text: token("--text-muted"),
      grid: token("--border-default"),
      buy: token("--trade-buy"),
      sell: token("--trade-sell"),
      entry: token("--text-primary"),
      sweep: token("--accent-primary"),
    };
    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.text,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 10,
        // Lightweight Charts licence: keep the TradingView attribution.
        attributionLogo: true,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { labelVisible: true }, vertLine: { labelVisible: false } },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: colors.buy,
      downColor: colors.sell,
      borderVisible: false,
      wickUpColor: colors.buy,
      wickDownColor: colors.sell,
      priceFormat: { type: "price", precision: decimals, minMove: 1 / 10 ** decimals },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    series.setData(candles.map((c) => ({ ...c, time: (c.time + LAGOS_OFFSET_S) as UTCTimestamp })));
    const style = {
      entry: { color: colors.entry, lineStyle: LineStyle.Solid },
      stop: { color: colors.sell, lineStyle: LineStyle.Dashed },
      target: { color: colors.buy, lineStyle: LineStyle.Dashed },
      sweep: { color: colors.sweep, lineStyle: LineStyle.Dotted },
    } as const;
    for (const level of levels) {
      series.createPriceLine({
        price: level.price,
        title: level.label,
        lineWidth: 1,
        axisLabelVisible: true,
        ...style[level.kind],
      });
    }
    chart.timeScale().fitContent();
    const unregister = captureId ? registerChartCapture(captureId, () => chart.takeScreenshot()) : () => {};
    return () => {
      unregister();
      chart.remove();
    };
  }, [candles, levels, decimals, captureId]);

  if (candles.length === 0) {
    return <p className="flex aspect-[338/170] items-center justify-center text-sm text-muted">No stored candles around this alert.</p>;
  }
  return <div ref={container} role="img" aria-label={label} className="aspect-[338/190] w-full" />;
}
