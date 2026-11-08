"use client";

// The full chart (TradingView Lightweight Charts v5). One client component,
// loaded with next/dynamic (ssr: false) by ChartView. Candles come in via
// props: the first page, older pages prepended (scroll-back) and new closed
// candles appended (refresh) without resetting zoom or scroll.
import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { barTimeFor, formatChartTick, formatChartTime } from "@/lib/data/format";
import { registerChartCapture } from "@/components/ask-claude/capture";
import type { ChartAlertView, ChartCandle, ChartLevelView, ChartTimeframe } from "@/lib/data/types";

export interface ChartLayers {
  pd: boolean;
  asia: boolean;
  eq: boolean;
  alerts: boolean;
  trade: boolean;
}

/** Load older history when fewer than this many bars are left of the view. */
const LOAD_OLDER_WHEN_BARS_LEFT = 15;
const M15_S = 15 * 60;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface Props {
  candles: ChartCandle[];
  timeframe: ChartTimeframe;
  decimals: number;
  levels: ChartLevelView[];
  alerts: ChartAlertView[];
  active: ChartAlertView[];
  layers: ChartLayers;
  /** Older history exists (ChartView decides; kept for clarity). */
  hasMore: boolean;
  onNeedOlder: () => void;
  onAlertsTapped: (ids: string[]) => void;
  /** Registers the chart's screenshot for Ask Claude under this id. */
  captureId?: string;
}

export default function CandleChart(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const overlayRef = useRef<{ lines: IPriceLine[]; segments: ISeriesApi<"Line">[] }>({ lines: [], segments: [] });
  const loadedRef = useRef<{ first: number | null; last: number | null }>({ first: null, last: null });
  const markerTimesRef = useRef<Map<number, string[]>>(new Map());
  // Latest callbacks / flags without re-creating the chart.
  const live = useRef({ onNeedOlder: props.onNeedOlder, onAlertsTapped: props.onAlertsTapped });
  useEffect(() => {
    live.current = { onNeedOlder: props.onNeedOlder, onAlertsTapped: props.onAlertsTapped };
  }, [props.onNeedOlder, props.onAlertsTapped]);
  const { levels, alerts, active, layers, candles: bars, decimals } = props;

  // Create once per mount (ChartView remounts on pair / timeframe change).
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const colors = { text: token("--text-muted"), grid: token("--border-default"), buy: token("--trade-buy"), sell: token("--trade-sell") };
    const chart = createChart(el, {
      autoSize: true, // ResizeObserver: follows the screen width
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.text,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 11,
        attributionLogo: true, // Lightweight Charts licence
      },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: props.timeframe !== "D",
        secondsVisible: false,
        rightOffset: 4,
        tickMarkFormatter: (time: Time, kind: number) => formatChartTick(time as number, kind),
      },
      localization: {
        timeFormatter: (time: Time) => formatChartTime(time as number, props.timeframe),
        priceFormatter: (price: number) => price.toFixed(props.decimals),
      },
      // Drag sideways to go back in time and pinch to zoom; vertical swipes scroll the page.
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { pinch: true, mouseWheel: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      kineticScroll: { touch: true, mouse: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: colors.buy,
      downColor: colors.sell,
      borderVisible: false,
      wickUpColor: colors.buy,
      wickDownColor: colors.sell,
      priceFormat: { type: "price", precision: props.decimals, minMove: 1 / 10 ** props.decimals },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);

    const onRange = (range: { from: number } | null) => {
      // Near the left edge: ask for older history (the view reports "start of history" when there is none).
      if (range && range.from < LOAD_OLDER_WHEN_BARS_LEFT) live.current.onNeedOlder();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const onClick = (param: { time?: Time }) => {
      if (param.time === undefined) return;
      const ids = markerTimesRef.current.get(param.time as number);
      if (ids && ids.length > 0) live.current.onAlertsTapped(ids);
    };
    chart.subscribeClick(onClick);
    // Ask Claude's picture: the panes with the level lines and the axes.
    const unregister = props.captureId ? registerChartCapture(props.captureId, () => chart.takeScreenshot()) : () => {};

    return () => {
      unregister();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeClick(onClick);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      overlayRef.current = { lines: [], segments: [] };
      loadedRef.current = { first: null, last: null };
    };
    // Timeframe / decimals change remounts the component (key), so they are fixed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Candles: first load, prepend older (keep the view where it was), append newer.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const candles = props.candles;
    if (!chart || !series || candles.length === 0) return;
    const data = candles.map((c) => ({ ...c, time: c.time as UTCTimestamp }));
    const { first, last } = loadedRef.current;
    const newFirst = candles[0]?.time ?? null;
    const newLast = candles.at(-1)?.time ?? null;
    if (first === null) {
      series.setData(data);
      const bars = Math.min(120, data.length);
      chart.timeScale().setVisibleLogicalRange({ from: data.length - bars, to: data.length + 3 });
    } else if (newFirst !== null && newFirst < first) {
      const added = candles.findIndex((c) => c.time === first);
      const range = chart.timeScale().getVisibleLogicalRange();
      series.setData(data);
      if (range && added > 0) chart.timeScale().setVisibleLogicalRange({ from: range.from + added, to: range.to + added });
    } else if (newLast !== null && last !== null && newLast > last) {
      for (const c of data) if ((c.time as number) > last) series.update(c);
    }
    loadedRef.current = { first: newFirst, last: newLast };
  }, [props.candles]);

  // Overlays: levels, equal-level segments, trade lines, alert markers.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const c = {
      pd: token("--accent-primary"),
      asia: token("--accent-soft"),
      eq: token("--text-soft"),
      entry: token("--text-primary"),
      stop: token("--trade-sell"),
      target: token("--trade-buy"),
      live: token("--accent-primary"),
      test: token("--text-muted"),
    };
    for (const line of overlayRef.current.lines) series.removePriceLine(line);
    for (const seg of overlayRef.current.segments) chart.removeSeries(seg);
    overlayRef.current = { lines: [], segments: [] };
    const barTimes = bars.map((k) => k.time);
    const lastBar = barTimes.at(-1);

    for (const level of levels) {
      const isPd = level.kind === "PDH" || level.kind === "PDL";
      const isAsia = level.kind === "ASH" || level.kind === "ASL";
      if ((isPd && layers.pd) || (isAsia && layers.asia)) {
        overlayRef.current.lines.push(
          series.createPriceLine({
            price: level.price,
            color: isPd ? c.pd : c.asia,
            lineStyle: isPd ? LineStyle.Dashed : LineStyle.Dotted,
            lineWidth: 1,
            title: isAsia ? (level.kind === "ASH" ? "Asia H" : "Asia L") : level.kind,
            axisLabelVisible: true,
          }),
        );
      }
      if ((level.kind === "EQH" || level.kind === "EQL") && layers.eq && lastBar !== undefined) {
        // A short line from the first swing of the group to now.
        const start = barTimeFor(level.since, barTimes) ?? barTimes[0];
        if (start === undefined) continue;
        const seg = chart.addSeries(LineSeries, {
          color: c.eq,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          title: level.kind,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          priceFormat: { type: "price", precision: decimals, minMove: 1 / 10 ** decimals },
        });
        seg.setData(
          start === lastBar
            ? [{ time: lastBar as UTCTimestamp, value: level.price }]
            : [
                { time: start as UTCTimestamp, value: level.price },
                { time: lastBar as UTCTimestamp, value: level.price },
              ],
        );
        overlayRef.current.segments.push(seg);
      }
    }

    if (layers.trade) {
      for (const a of active) {
        if (a.entry === null || a.stop === null || a.target === null) continue;
        const code = a.strategy.code;
        overlayRef.current.lines.push(
          series.createPriceLine({ price: a.entry, color: c.entry, lineStyle: LineStyle.Solid, lineWidth: 1, title: `${a.entryType === "LIMIT" ? "Limit" : "Entry"} ${code}` }),
          series.createPriceLine({ price: a.stop, color: c.stop, lineStyle: LineStyle.Dashed, lineWidth: 1, title: `SL ${code}` }),
          series.createPriceLine({ price: a.target, color: c.target, lineStyle: LineStyle.Dashed, lineWidth: 1, title: `TP ${code}` }),
        );
      }
    }

    const markers: SeriesMarker<Time>[] = [];
    const byTime = new Map<number, string[]>();
    if (layers.alerts) {
      for (const a of alerts) {
        const color = a.isTest ? c.test : c.live;
        const above = a.direction === "SELL";
        const add = (iso: string, kind: "sweep" | "ready") => {
          const t = barTimeFor(iso, barTimes);
          if (t === null) return;
          markers.push({
            id: `${a.id}:${kind}`,
            time: t as UTCTimestamp,
            position: above ? "aboveBar" : "belowBar",
            shape: kind === "sweep" ? "circle" : above ? "arrowDown" : "arrowUp",
            color,
            text: kind === "ready" ? a.strategy.code : undefined,
            size: kind === "sweep" ? 0.8 : 1,
          });
          byTime.set(t, [...(byTime.get(t) ?? []), a.id]);
        };
        add(a.sweepTime, "sweep");
        if (a.readyAt) add(new Date(Date.parse(a.readyAt) - M15_S * 1000).toISOString(), "ready");
      }
    }
    markers.sort((x, y) => (x.time as number) - (y.time as number));
    markersRef.current?.setMarkers(markers);
    markerTimesRef.current = byTime;
  }, [levels, alerts, active, layers, bars, decimals]);

  return <div ref={container} className="h-[360px] w-full touch-pan-y" />;
}
