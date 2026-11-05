// Formats backtest results as Markdown (used for both console and .md) and
// a one-row-per-trade CSV.
import type { Pair } from "@/lib/types";
import type { StrategySettings } from "@/lib/strategy/types";
import { lagos, price } from "../../worker/format";
import type { TradeRecord } from "./engine";
import type { Summary } from "./stats";

const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
const r = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`);
const usd = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`;

export interface ReportMeta {
  strategyId: string;
  strategyName: string;
  from: string;
  to: string;
  settings: StrategySettings;
  generatedAt: string;
  durationMs: number;
}

function summaryLines(title: string, s: Summary): string[] {
  const month = (m: Summary["bestMonth"]) => (m ? `${m.month} (${r(m.netR)})` : "—");
  return [
    `### ${title}`,
    "",
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Setups (sweeps) | ${s.setups} |`,
    `| Confirmed / expired / invalid / still watching | ${s.confirmed} / ${s.expired} / ${s.invalid} / ${s.watchingAtEnd} |`,
    `| Trades | ${s.trades} |`,
    `| Wins / losses / unresolved / open at end | ${s.wins} / ${s.losses} / ${s.unresolved} / ${s.open} |`,
    `| Win rate (wins ÷ (wins + losses)) | ${pct(s.winRate)} |`,
    `| Net R | ${r(s.netR)} |`,
    `| Net $ | ${usd(s.netUsd)} |`,
    `| Average R per closed trade | ${r(s.avgR)} |`,
    `| Worst losing streak | ${s.worstLosingStreak} |`,
    `| Max drawdown | ${s.maxDrawdownR.toFixed(2)}R / $${s.maxDrawdownUsd.toFixed(2)} |`,
    `| Best month / worst month | ${month(s.bestMonth)} / ${month(s.worstMonth)} |`,
    `| Losses with stop and target in the same candle | ${s.sameCandleLosses} |`,
    `| Losses that gapped through the stop | ${s.gappedLosses} |`,
    "",
    ...(s.months.length > 0
      ? [
          `| Month (Lagos) | Trades | Wins | Losses | Net R |`,
          `| --- | ---: | ---: | ---: | ---: |`,
          ...s.months.map((m) => `| ${m.month} | ${m.trades} | ${m.wins} | ${m.losses} | ${r(m.netR)} |`),
          "",
        ]
      : []),
  ];
}

export function formatReport(
  meta: ReportMeta,
  perPair: ReadonlyArray<{ pair: Pair; summary: Summary }>,
  total: Summary,
): string {
  const st = meta.settings;
  return [
    `# Backtest · ${meta.strategyName} (${meta.strategyId})`,
    "",
    `Range: ${meta.from} → ${meta.to} (UTC) · generated ${meta.generatedAt} · ran in ${(meta.durationMs / 1000).toFixed(1)} s`,
    "",
    `Settings: account $${st.accountSizeUsd} (fixed, no compounding) · risk ${st.riskPct}% · reward 1:${st.rewardRatio} · stop buffer ${st.stopBufferPips} pips · watch expiry ${st.watchExpiryMinutes} min · swing strength ${st.swingStrength} · equal tolerance ${st.equalTolerancePips} pips · paper timeout 288 M15 candles`,
    "",
    "Sample results from historical data. Not a promise of future results.",
    "",
    "## Total",
    "",
    ...summaryLines(`All pairs (${perPair.map((p) => p.pair).join(", ")})`, total),
    "## Per pair",
    "",
    ...perPair.flatMap(({ pair, summary }) => summaryLines(pair, summary)),
  ].join("\n");
}

const CSV_HEADER = [
  "pair",
  "direction",
  "sweep_type",
  "sweep_level",
  "sweep_time_utc",
  "sweep_time_lagos",
  "bos_level",
  "confirm_candle_utc",
  "confirm_candle_lagos",
  "entry",
  "stop",
  "target",
  "stop_pips",
  "lot_size",
  "risk_usd",
  "exit_time_utc",
  "exit_time_lagos",
  "exit_price",
  "status",
  "r",
  "usd",
  "note",
];

function csvCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** One row per trade. Times in UTC and Lagos so DG can find each on his charts. */
export function tradesCsv(trades: readonly TradeRecord[]): string {
  const sorted = [...trades].sort((a, b) => a.trade.openedAt.localeCompare(b.trade.openedAt));
  const rows = sorted.map(({ setup, ticket, result }) => {
    const p = (v: number) => price(setup.pair, v);
    return [
      setup.pair,
      setup.direction,
      setup.sweepType,
      p(setup.sweepLevel),
      setup.sweepTime,
      lagos(setup.sweepTime),
      p(setup.bosLevel),
      setup.confirmTime,
      setup.confirmTime ? lagos(setup.confirmTime) : undefined,
      p(ticket.entry),
      p(ticket.stop),
      p(ticket.target),
      ticket.stopPips,
      ticket.lotSize,
      ticket.riskUsd,
      result.closedAt,
      result.closedAt ? lagos(result.closedAt) : undefined,
      result.exitPrice === undefined ? undefined : p(result.exitPrice),
      result.status,
      result.resultR,
      result.pnlUsd,
      result.note,
    ]
      .map(csvCell)
      .join(",");
  });
  return [CSV_HEADER.join(","), ...rows].join("\n") + "\n";
}
