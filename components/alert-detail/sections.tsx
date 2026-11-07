// Alert screen sections (server components) — doc/design/alert-detail.html.
import Link from "next/link";
import { Check, ChevronRight, Circle, Minus, X } from "lucide-react";
import { formatDateTime, formatPrice, formatR, formatUsd, formatWhen, pairDecimals, pairLabel } from "@/lib/data/format";
import { paperOutcomeText } from "@/lib/data/logic";
import type { AlertDetail, RuleItem } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { PaperBadge, SideBadge, StatusBadge, StrategyBadge } from "@/components/alerts/badges";
import { RiskGuardCard } from "@/components/risk/risk-guard-card";
import { AskClaudeButton, DecisionBar, TicketCell } from "./interactive";
import { MiniChart, type ChartLevel } from "./mini-chart";

export function DetailHeader({ alert: a }: { alert: AlertDetail }) {
  const others = a.seenBy.slice(1);
  return (
    <>
      <header className="flex items-center gap-2.5">
        <SideBadge direction={a.direction} large />
        <h1 className="flex-1 text-[26px] leading-tight font-bold tracking-[-0.02em]">{pairLabel(a.pair)}</h1>
        <StatusBadge status={a.status} test={a.isTest} />
      </header>
      <p className="-mt-1.5 font-mono text-xs text-muted">
        {formatDateTime(a.time)} Lagos · {a.strategy.name}
        {a.isTest && " · Test (no alert sent)"}
      </p>
      <div className="-mt-1 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">Seen by</span>
        <StrategyBadge tag={a.strategy} withName testPrefix />
        {others.length > 0 && <span className="text-xs text-muted">· also</span>}
        {others.map((t) => (
          <StrategyBadge key={t.id} tag={t} testPrefix />
        ))}
      </div>
    </>
  );
}

/** News warning near red news (Unit 15). Renders nothing until then. */
export function NewsWarningSlot() {
  return null;
}

export function ChartCard({ alert: a }: { alert: AlertDetail }) {
  const p = (v: number) => formatPrice(a.pair, v);
  const levels: ChartLevel[] = [
    ...(a.ticket
      ? [
          { kind: "stop" as const, price: a.ticket.stop, label: "SL" },
          { kind: "entry" as const, price: a.ticket.entry, label: a.ticket.entryType === "LIMIT" ? "Limit" : "Entry" },
          { kind: "target" as const, price: a.ticket.target, label: "TP" },
        ]
      : []),
    { kind: "sweep" as const, price: a.sweepLevel, label: a.sweepType },
  ];
  const description = `15 minute chart around the alert: swept ${a.sweepTypeLabel} ${p(a.sweepLevel)}${
    a.ticket ? `, entry ${p(a.ticket.entry)}, stop ${p(a.ticket.stop)}, target ${p(a.ticket.target)}` : ""
  }.`;
  return (
    <figure className="m-0 rounded-2xl border border-default bg-surface p-2.5">
      <MiniChart candles={a.candles} levels={levels} decimals={pairDecimals(a.pair)} label={description} />
      <Link
        href={`/chart?pair=${a.pair}&tf=M15&alert=${a.id}`}
        className="flex min-h-11 items-center justify-center gap-1.5 text-sm font-semibold text-accent no-underline"
      >
        Open full chart
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </figure>
  );
}

const RULE_ICON: Record<RuleItem["state"], { icon: typeof Check; className: string; label: string }> = {
  met: { icon: Check, className: "text-success", label: "Met" },
  "not-met": { icon: X, className: "text-error", label: "Not met" },
  pending: { icon: Circle, className: "text-muted", label: "Waiting" },
  info: { icon: Minus, className: "text-muted", label: "Background" },
};

export function RulesCard({ alert: a }: { alert: AlertDetail }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-default bg-surface p-4">
      <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Rules · {a.strategy.name}</h2>
      {a.rules.length === 0 && <p className="text-sm text-muted">This strategy is no longer registered.</p>}
      <ul className="flex flex-col gap-2.5">
        {a.rules.map((rule, i) => {
          const { icon: Icon, className, label } = RULE_ICON[rule.state];
          return (
            <li key={i} className="flex gap-2.5 text-sm text-check">
              <Icon className={cn("mt-0.5 h-[18px] w-[18px] flex-none", className)} strokeWidth={2.4} aria-label={label} />
              <div className="min-w-0">
                <p>{rule.text}</p>
                {rule.detail && <p className="mt-0.5 font-mono text-xs text-muted">{rule.detail}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">✓ / ✗ come from what the alert recorded; nothing is recomputed.</p>
    </section>
  );
}

export function TicketCard({ alert: a }: { alert: AlertDetail }) {
  const t = a.ticket;
  if (!t) {
    return (
      <section className="flex flex-col gap-2.5 rounded-2xl border border-default bg-surface p-4">
        <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Trade ticket</h2>
        <p className="text-sm text-muted">
          {a.status === "WATCHING" ? "Appears when the setup is confirmed." : "No ticket: this setup never reached Ready."}
        </p>
      </section>
    );
  }
  const p = (v: number) => formatPrice(a.pair, v);
  const limit = t.entryType === "LIMIT";
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-default bg-surface p-4">
      <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Trade ticket</h2>
      <div className="grid grid-cols-3 gap-2">
        <TicketCell label={limit ? "Limit" : "Entry"} value={p(t.entry)} />
        <TicketCell label={`Stop · ${t.stopPips}p`} value={p(t.stop)} tone="sell" />
        <TicketCell label={`Target · ${t.targetPips}p`} value={p(t.target)} tone="buy" />
        <TicketCell label={`Risk · ${t.riskPct}%`} value={formatUsd(t.riskUsd, { sign: false })} copy={t.riskUsd.toFixed(2)} />
        <TicketCell label={`Reward · 1:${t.rewardRatio}`} value={formatUsd(t.rewardUsd, { sign: false })} copy={null} />
        <TicketCell label="Lot size" value={t.lotSize.toFixed(2)} highlight />
      </div>
      {limit && t.entryValidUntil && (
        <p className="text-xs text-muted">
          Limit order: valid until <span className="font-mono">{formatDateTime(t.entryValidUntil)}</span> Lagos. If price
          doesn&apos;t come back to it, there is no trade.
        </p>
      )}
    </section>
  );
}

export function PaperCard({ alert: a, now }: { alert: AlertDetail; now: Date }) {
  const paper = a.paper;
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-default bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Paper trade</h2>
        {paper && <PaperBadge paper={paper} prefix="" />}
      </div>
      {!paper ? (
        <p className="text-sm text-check">
          {a.status === "WATCHING"
            ? "Opens automatically if this setup reaches Ready, whether or not you take it."
            : "No paper trade: this setup never reached Ready with a valid ticket."}
        </p>
      ) : (
        <>
          <p className="text-sm text-check">{paperOutcomeText(paper)}</p>
          {paper.status === "OPEN" && a.ticket && (
            <p className="text-sm text-check">
              Target <span className="font-mono">{formatPrice(a.pair, a.ticket.target)}</span> (+{a.ticket.rewardRatio}R ·{" "}
              {formatUsd(a.ticket.rewardUsd)}) or stop <span className="font-mono">{formatPrice(a.pair, a.ticket.stop)}</span> (−1R ·{" "}
              {formatUsd(-a.ticket.riskUsd)}).
            </p>
          )}
          {paper.status !== "OPEN" && paper.status !== "NOT_FILLED" && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Result</dt>
              <dd className="font-mono">
                {paper.resultR !== null ? formatR(paper.resultR) : "—"} · {paper.pnlUsd !== null ? formatUsd(paper.pnlUsd) : "—"}
              </dd>
              <dt className="text-muted">Exit price</dt>
              <dd className="font-mono">{paper.exitPrice !== null ? formatPrice(a.pair, paper.exitPrice) : "—"}</dd>
              <dt className="text-muted">Closed</dt>
              <dd className="font-mono">{paper.closedAt ? formatWhen(paper.closedAt, now) : "—"}</dd>
              {paper.note && (
                <>
                  <dt className="text-muted">Note</dt>
                  <dd>{paper.note}</dd>
                </>
              )}
            </dl>
          )}
        </>
      )}
      <p className="text-xs text-muted">Paper result assumes entry at the alert price with no spread or commission.</p>
    </section>
  );
}

export function AskClaudeCard({ alert: a }: { alert: AlertDetail }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-default bg-surface p-4">
      <div>
        <h2 className="text-base font-semibold">Want a second opinion?</h2>
        <p className="mt-1 text-[13px] text-muted">
          Copies this setup with your rules, then opens Claude. Paste it and ask.
        </p>
      </div>
      <AskClaudeButton summary={a.summary} />
    </section>
  );
}

export function DecisionSection({ alert: a }: { alert: AlertDetail }) {
  if (a.taken) {
    return (
      <p className="rounded-2xl border border-accent p-4 text-sm">
        You took this trade. It&apos;s in your <Link href="/journal" className="text-accent">Journal</Link>.
      </p>
    );
  }
  if (a.status === "SKIPPED") return <p className="text-center text-sm text-muted">You skipped this alert.</p>;
  if (a.status === "WATCHING") {
    return <p className="text-center text-sm text-muted">Still watching: you can take or skip it once it&apos;s Ready.</p>;
  }
  if (!a.canDecide) return null;
  const g = a.guard;
  const warning =
    g.state === "stopped" || g.state === "breached"
      ? `${g.title}. ${g.reasons[0] ?? ""}`.trim()
      : a.takeWouldBreach
        ? `Taking it puts your worst case today past your ${g.limits.dailyLossLimitPct}% daily limit if every stop is hit.`
        : null;
  return (
    <>
      <RiskGuardCard guard={g} variant="banner" link="/journal" />
      <DecisionBar alertId={a.id} pairText={`${pairLabel(a.pair)} ${a.direction}`} riskWarning={warning} />
    </>
  );
}
