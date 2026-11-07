"use client";

// The /chart page body (doc/design/chart.html). The heavy chart itself is
// loaded with next/dynamic (ssr: false) so the page shell renders at once.
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import { loadOlderCandles, refreshChart } from "@/lib/data/chart-actions";
import { formatClock, formatPrice, pairLabel } from "@/lib/data/format";
import type { CandlePage, ChartAlertView, ChartCandle, ChartContext, ChartPairOption, ChartTimeframe, Trend } from "@/lib/data/types";
import { buildChartSummary } from "@/lib/summary";
import { cn } from "@/lib/utils";
import { SideBadge, StatusBadge, StrategyBadge } from "@/components/alerts/badges";
import { readShowTest, saveShowTest } from "@/components/show-test-signals";
import { SkeletonBlock } from "@/components/ui/skeleton-block";
import { ToggleSwitch } from "@/components/toggle-switch";
import { useToast } from "@/components/toast";
import type { ChartLayers } from "./candle-chart";

const CandleChart = dynamic(() => import("./candle-chart"), {
  ssr: false,
  loading: () => <SkeletonBlock className="h-[360px] w-full" />,
});

const LAYERS_KEY = "donquixote.chartLayers";
const DEFAULT_LAYERS: ChartLayers = { pd: true, asia: true, eq: true, alerts: true, trade: true };
const REFRESH_MS = 60_000;
const TIMEFRAMES: ReadonlyArray<{ value: ChartTimeframe; label: string }> = [
  { value: "D", label: "D" },
  { value: "H4", label: "4H" },
  { value: "M15", label: "15m" },
];

function readLayers(): ChartLayers {
  try {
    const raw = window.localStorage.getItem(LAYERS_KEY);
    return raw ? { ...DEFAULT_LAYERS, ...(JSON.parse(raw) as Partial<ChartLayers>) } : DEFAULT_LAYERS;
  } catch {
    return DEFAULT_LAYERS;
  }
}

function saveLayers(layers: ChartLayers) {
  try {
    window.localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
  } catch {
    // Not remembered this time.
  }
}

function TrendBadge({ label, trend }: { label: string; trend: Trend }) {
  const text = trend === "UP" ? "up" : trend === "DOWN" ? "down" : "range";
  return (
    <span
      className={cn(
        "rounded-lg px-2 py-0.5 font-mono text-xs font-semibold",
        trend === "UP" ? "bg-buy text-buy" : trend === "DOWN" ? "bg-sell text-sell" : "border border-input text-muted",
      )}
    >
      {label} {text}
    </span>
  );
}

export function ChartView({
  pairs,
  pair,
  timeframe,
  alertId,
  initialCandles,
  initialContext,
}: {
  pairs: ChartPairOption[];
  pair: ChartContext["pair"];
  timeframe: ChartTimeframe;
  alertId?: string;
  initialCandles: CandlePage;
  initialContext: ChartContext;
}) {
  const router = useRouter();
  const toast = useToast();
  const [navigating, startNavigation] = useTransition();
  const [candles, setCandles] = useState<ChartCandle[]>(initialCandles.candles);
  const [hasMore, setHasMore] = useState(initialCandles.hasMore);
  const [reachedStart, setReachedStart] = useState(false);
  const [context, setContext] = useState<ChartContext>(initialContext);
  const [layers, setLayers] = useState<ChartLayers>(DEFAULT_LAYERS);
  const [showTest, setShowTest] = useState(false);
  const [tapped, setTapped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loadingOlder = useRef(false);
  const latest = useRef({ candles, hasMore });
  useEffect(() => {
    latest.current = { candles, hasMore };
  }, [candles, hasMore]);

  // Device settings (after mount: browser storage).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayers(readLayers());
    setShowTest(readShowTest());
  }, []);

  const navigate = (next: { pair?: string; tf?: ChartTimeframe }) => {
    const params = new URLSearchParams({ pair: next.pair ?? pair, tf: next.tf ?? timeframe });
    startNavigation(() => router.replace(`/chart?${params.toString()}`, { scroll: false }));
  };

  const loadOlder = useCallback(async () => {
    const { candles: now, hasMore: more } = latest.current;
    if (!more) {
      setReachedStart(true);
      return;
    }
    const first = now[0];
    if (!first || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      const page = await loadOlderCandles({ pair, timeframe, before: first.time });
      setCandles((prev) => [...page.candles.filter((c) => c.time < (prev[0]?.time ?? Infinity)), ...prev]);
      setHasMore(page.hasMore);
      if (!page.hasMore) setReachedStart(true);
    } catch {
      setError("Could not load older candles.");
    } finally {
      loadingOlder.current = false;
    }
  }, [pair, timeframe]);

  const refresh = useCallback(async () => {
    const { candles: now } = latest.current;
    const last = now.at(-1);
    const first = now[0];
    if (!last || !first) return;
    try {
      const { candles: page, context: next } = await refreshChart({ pair, timeframe, after: last.time, from: first.time, alertId });
      if (page.candles.length > 0) setCandles((prev) => [...prev, ...page.candles.filter((c) => c.time > (prev.at(-1)?.time ?? 0))]);
      setContext(next);
      setError(null);
    } catch {
      // A missed refresh is fine: the next one catches up.
    }
  }, [pair, timeframe, alertId]);

  // New closed candles every minute while the market is open, and when the tab comes back.
  useEffect(() => {
    if (!context.marketOpen) return;
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [context.marketOpen, refresh]);

  const visibleAlerts = useMemo(() => context.alerts.filter((a) => showTest || !a.isTest), [context.alerts, showTest]);
  const activeAlerts = useMemo(() => context.active.filter((a) => showTest || !a.isTest || a.id === alertId), [context.active, showTest, alertId]);
  const tappedAlerts = useMemo(
    () => tapped.map((id) => context.alerts.find((a) => a.id === id)).filter((a): a is ChartAlertView => a !== undefined),
    [tapped, context.alerts],
  );

  const setLayer = (key: keyof ChartLayers, on: boolean) => {
    const next = { ...layers, [key]: on };
    setLayers(next);
    saveLayers(next);
  };

  const askClaude = async () => {
    const text = buildChartSummary({
      pair,
      timeframe,
      lastPrice: context.lastClose,
      lastCandleClose: context.lastCandleClose,
      trendD: context.trendD,
      trendH4: context.trendH4,
      levels: context.levels,
      alerts: activeAlerts.map((a) => ({
        direction: a.direction,
        status: a.status,
        strategyName: a.strategy.name,
        live: !a.isTest,
        entryType: a.entryType,
        entry: a.entry,
        stop: a.stop,
        target: a.target,
        stopPips: a.stopPips,
        targetPips: a.targetPips,
        lotSize: a.lotSize,
      })),
    });
    const tab = window.open("https://claude.ai/new", "_blank", "noopener");
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    toast(ok ? "Copied — paste it into Claude" : "Couldn't copy automatically. Try again.");
    if (!tab && ok) window.location.assign("https://claude.ai/new");
  };

  const change = context.dayChange;
  const p = (v: number) => formatPrice(pair, v);
  return (
    <>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Pair">
        {pairs.map((o) => (
          <button
            key={o.pair}
            type="button"
            aria-pressed={o.pair === pair}
            onClick={() => o.pair !== pair && navigate({ pair: o.pair })}
            className={cn(
              "h-9 flex-none rounded-[18px] border px-3.5 text-[13px] font-semibold",
              o.pair === pair ? "border-accent bg-accent text-on-accent" : "border-input bg-surface",
              !o.enabled && o.pair !== pair && "opacity-60",
            )}
          >
            {pairLabel(o.pair)}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[22px] font-semibold">{context.lastClose !== null ? p(context.lastClose) : "—"}</p>
          {change && (
            <p className={cn("font-mono text-[13px]", change.changePips > 0 ? "text-buy" : change.changePips < 0 ? "text-sell" : "text-muted")}>
              {change.changePips > 0 ? "+" : change.changePips < 0 ? "−" : ""}
              {Math.abs(change.changePips)} pips ({change.changePct > 0 ? "+" : change.changePct < 0 ? "−" : ""}
              {Math.abs(change.changePct).toFixed(2)}%) today
            </p>
          )}
        </div>
        <div className="inline-flex gap-1 rounded-[10px] bg-base p-[3px]" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={t.value === timeframe}
              onClick={() => t.value !== timeframe && navigate({ tf: t.value })}
              className={cn(
                "h-[34px] min-w-[52px] rounded-lg px-2.5 font-mono text-[13px] font-semibold",
                t.value === timeframe ? "bg-accent text-on-accent" : "text-soft",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="-mt-1 flex flex-wrap items-center gap-2">
        <TrendBadge label="D" trend={context.trendD} />
        <TrendBadge label="4H" trend={context.trendH4} />
        {context.lastCandleClose && (
          <span className="font-mono text-xs text-muted">Last closed candle {formatClock(context.lastCandleClose)}</span>
        )}
        {!context.marketOpen && <span className="text-xs text-muted">· Market closed</span>}
      </div>

      <figure className={cn("relative m-0 rounded-2xl border border-default bg-surface px-1 pt-2 pb-2.5", navigating && "opacity-60")}>
        {candles.length === 0 ? (
          <div className="flex h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-muted">No candles stored yet for this pair.</p>
            <button type="button" onClick={() => router.refresh()} className="h-11 rounded-xl border border-input px-4 font-semibold">
              Retry
            </button>
          </div>
        ) : (
          <CandleChart
            key={`${pair}:${timeframe}`}
            candles={candles}
            timeframe={timeframe}
            decimals={context.decimals}
            levels={context.levels}
            alerts={visibleAlerts}
            active={activeAlerts}
            layers={layers}
            hasMore={hasMore}
            onNeedOlder={loadOlder}
            onAlertsTapped={setTapped}
          />
        )}
        {reachedStart && <p className="px-2.5 pt-1 text-xs text-muted">Start of stored history</p>}
        <div className="flex flex-wrap gap-x-3.5 gap-y-2 px-2.5 pt-1.5 text-xs text-muted">
          {layers.pd && <Legend tone="text-accent" dash="dashed" label="Prev day high/low" />}
          {layers.asia && <Legend tone="text-accent-soft" dash="dotted" label="Asian high/low" />}
          {layers.eq && <Legend tone="text-soft" dash="dotted" label="Equal highs/lows" />}
          {layers.trade && <Legend tone="text-foreground" dash="solid" label="Entry" />}
          {layers.trade && <Legend tone="text-sell" dash="dashed" label="Stop" />}
          {layers.trade && <Legend tone="text-buy" dash="dashed" label="Target" />}
        </div>
      </figure>

      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      {tappedAlerts.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border border-default bg-surface p-3.5" aria-label="Alerts at this candle">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Alerts at this candle</h2>
            <button type="button" aria-label="Close" onClick={() => setTapped([])} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {tappedAlerts.map((a) => (
            <Link key={a.id} href={`/alerts/${a.id}`} className="flex items-center gap-2.5 text-foreground no-underline">
              <SideBadge direction={a.direction} />
              <span className="flex-1 truncate text-sm">
                Swept {a.sweepType} {p(a.sweepLevel)}
              </span>
              <StrategyBadge tag={a.strategy} />
              <StatusBadge status={a.status} test={a.isTest} />
            </Link>
          ))}
        </section>
      )}

      <section aria-label="Levels to show" className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
        <ToggleRow label="Previous day high / low" checked={layers.pd} onChange={(v) => setLayer("pd", v)} />
        <ToggleRow label="Asian session high / low" checked={layers.asia} onChange={(v) => setLayer("asia", v)} />
        <ToggleRow label="Equal highs / lows" checked={layers.eq} onChange={(v) => setLayer("eq", v)} />
        <ToggleRow label="Alerts on the chart" checked={layers.alerts} onChange={(v) => setLayer("alerts", v)} />
        <ToggleRow
          label="Show test signals"
          hint="Same setting as on Alerts"
          checked={showTest}
          onChange={(v) => {
            setShowTest(v);
            saveShowTest(v);
          }}
        />
        <ToggleRow label="Active trade levels" checked={layers.trade} onChange={(v) => setLayer("trade", v)} />
      </section>

      <button
        type="button"
        onClick={askClaude}
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-accent font-semibold text-accent"
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        Ask Claude about this chart
      </button>
      <p className="text-center text-xs text-muted">
        Closed candles only, from OANDA. {context.marketOpen ? "New candles appear every minute." : "The market is closed."}
      </p>
    </>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-[14px] py-1.5">
      <div>
        <p>{label}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function Legend({ tone, dash, label }: { tone: string; dash: "solid" | "dashed" | "dotted"; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", tone)}>
      <i className="inline-block w-3.5 border-t-2 border-current" style={{ borderTopStyle: dash }} aria-hidden="true" />
      {label}
    </span>
  );
}
