// Pure "Ask Claude" summary: alert + settings + risk state → plain text that
// DG pastes into Claude. Runs on the server and in the browser; no network.
// It asks Claude to check the setup against DG's rules, not to predict.
import type { Direction, EntryType, Pair } from "@/lib/types";
import { formatDateTime, formatPrice, formatR, formatUsd, pairLabel } from "@/lib/data/format";

export interface SummaryStrategy {
  name: string;
  mode: "LIVE" | "TEST" | "OFF";
}

export interface SummaryInput {
  pair: Pair;
  direction: Direction;
  status: string;
  /** ISO, UTC. */
  time: string;
  strategy: SummaryStrategy;
  /** Other strategies that saw the same setup. */
  alsoSeenBy: readonly SummaryStrategy[];
  sweepLabel: string;
  sweepLevel: number;
  /** e.g. "15m body closed below 1.10150" */
  confirmation: string;
  ticket: {
    entry: number;
    stop: number;
    target: number;
    stopPips: number;
    targetPips: number;
    rewardRatio: number;
    riskPct: number;
    riskUsd: number;
    lotSize: number;
    entryType: EntryType;
    /** ISO; LIMIT only. */
    entryValidUntil: string | null;
  } | null;
  paper: { status: string; resultR: number | null; pnlUsd: number | null } | null;
  accountSizeUsd: number;
  /** One line about the risk guard (Unit 14 fills in the maths). */
  riskGuard: string;
  /** News warning near the alert (Unit 15), or null. */
  news?: string | null;
  /** The strategy's rules, plain language. */
  rules: readonly string[];
}

const mode = (s: SummaryStrategy) => (s.mode === "LIVE" ? "live" : "test");

function paperLine(p: SummaryInput["paper"]): string {
  if (!p) return "Paper trade: none (alert not Ready)";
  switch (p.status) {
    case "OPEN":
      return "Paper trade: open (tracking to target or stop)";
    case "NOT_FILLED":
      return "Paper trade: limit entry not filled (0R)";
    default: {
      const r = p.resultR !== null ? formatR(p.resultR) : "";
      const usd = p.pnlUsd !== null ? formatUsd(p.pnlUsd) : "";
      return `Paper trade: ${p.status.toLowerCase()} ${[r, usd].filter(Boolean).join(" · ")}`.trim();
    }
  }
}

export function buildAlertSummary(input: SummaryInput): string {
  const p = (v: number) => formatPrice(input.pair, v);
  const strategies = [
    `${input.strategy.name} (${mode(input.strategy)})`,
    ...(input.alsoSeenBy.length > 0
      ? [`also seen by ${input.alsoSeenBy.map((s) => `${s.name} (${mode(s)})`).join(", ")}`]
      : []),
  ].join("; ");
  const t = input.ticket;
  const lines = [
    "Donquixote FX alert. Please check this against my trading rules.",
    "",
    `Pair: ${pairLabel(input.pair)} | Direction: ${input.direction} | Status: ${input.status} | Strategies: ${strategies}`,
    `Time: ${formatDateTime(input.time)} Lagos`,
    `Liquidity swept: ${input.sweepLabel} at ${p(input.sweepLevel)}`,
    `Confirmation: ${input.confirmation}`,
    ...(t
      ? [
          `${t.entryType === "LIMIT" ? `Limit entry ${p(t.entry)}${t.entryValidUntil ? ` (valid until ${formatDateTime(t.entryValidUntil)} Lagos)` : ""}` : `Entry ${p(t.entry)}`} | Stop ${p(t.stop)} (${t.stopPips} pips) | Target ${p(t.target)} (${t.targetPips} pips) | 1:${t.rewardRatio}`,
          `Risk: ${t.riskPct}% of ${formatUsd(input.accountSizeUsd, { sign: false })} = ${formatUsd(t.riskUsd, { sign: false })} | Lot size: ${t.lotSize.toFixed(2)}`,
        ]
      : ["Trade ticket: not ready yet (still watching)"]),
    paperLine(input.paper),
    `Risk guard: ${input.riskGuard}`,
    `News: ${input.news ?? "no red news within 30 min and no high-impact headline in the 15 min before"}`,
    "",
    `My rules (${input.strategy.name}): ${input.rules.join(" ")}`,
    "",
    "Does this setup follow all my rules? Is anything off, like stop placement, high-impact news coming up, or too much USD exposure? I know you can't predict whether it wins.",
  ];
  return lines.join("\n");
}

// --- "Ask Claude about this chart" (Unit 12) --------------------------------

export interface ChartSummaryInput {
  pair: Pair;
  timeframe: "D" | "H4" | "M15";
  lastPrice: number | null;
  /** ISO: close of the newest closed candle. */
  lastCandleClose: string | null;
  trendD: string;
  trendH4: string;
  levels: ReadonlyArray<{ kind: string; price: number }>;
  alerts: ReadonlyArray<{
    direction: Direction;
    status: string;
    strategyName: string;
    live: boolean;
    entryType: EntryType;
    entry: number | null;
    stop: number | null;
    target: number | null;
    stopPips: number | null;
    targetPips: number | null;
    lotSize: number | null;
  }>;
}

const LEVEL_NAMES: Record<string, string> = {
  PDH: "Previous day high",
  PDL: "Previous day low",
  ASH: "Asian session high",
  ASL: "Asian session low",
  EQH: "Equal highs",
  EQL: "Equal lows",
};
const TF_NAMES: Record<ChartSummaryInput["timeframe"], string> = { D: "Daily", H4: "4H", M15: "15m" };
const trendWord = (t: string) => (t === "UP" ? "up" : t === "DOWN" ? "down" : "ranging");

export function buildChartSummary(input: ChartSummaryInput): string {
  const p = (v: number) => formatPrice(input.pair, v);
  const aligned = input.trendD === input.trendH4 && input.trendD !== "RANGE";
  const levels = [...input.levels]
    .sort((a, b) => b.price - a.price)
    .map((l) => `- ${LEVEL_NAMES[l.kind] ?? l.kind}: ${p(l.price)}`);
  const alerts = input.alerts.map((a) => {
    const ticket =
      a.entry !== null && a.stop !== null && a.target !== null
        ? ` | ${a.entryType === "LIMIT" ? "Limit" : "Entry"} ${p(a.entry)} | Stop ${p(a.stop)}${a.stopPips !== null ? ` (${a.stopPips} pips)` : ""} | Target ${p(a.target)}${a.targetPips !== null ? ` (${a.targetPips} pips)` : ""}${a.lotSize !== null ? ` | ${a.lotSize.toFixed(2)} lots` : ""}`
        : "";
    return `- ${a.direction} · ${a.status} · ${a.strategyName} (${a.live ? "live" : "test"})${ticket}`;
  });
  return [
    "Donquixote FX chart. Please look at this with my trading rules in mind.",
    "",
    `Pair: ${pairLabel(input.pair)} | Timeframe: ${TF_NAMES[input.timeframe]} | Last price: ${input.lastPrice !== null ? p(input.lastPrice) : "—"}${
      input.lastCandleClose ? ` (last closed candle ${formatDateTime(input.lastCandleClose)} Lagos)` : ""
    }`,
    `Trend: Daily ${trendWord(input.trendD)}, 4H ${trendWord(input.trendH4)}${aligned ? " (aligned)" : " (not aligned)"}`,
    "",
    "Levels:",
    ...(levels.length > 0 ? levels : ["- none right now"]),
    "",
    "Active alerts on this pair:",
    ...(alerts.length > 0 ? alerts : ["- none"]),
    "",
    "Prices are from closed candles only (the candle still forming is not included).",
    "",
    "Where is liquidity likely to be swept next, and does the structure fit my rules? I know you can't predict the market.",
  ].join("\n");
}
