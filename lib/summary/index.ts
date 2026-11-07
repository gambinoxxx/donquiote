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
    "",
    `My rules (${input.strategy.name}): ${input.rules.join(" ")}`,
    "",
    "Does this setup follow all my rules? Is anything off, like stop placement, high-impact news coming up, or too much USD exposure? I know you can't predict whether it wins.",
  ];
  return lines.join("\n");
}
