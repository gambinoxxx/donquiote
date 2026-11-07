// Home (Overview) sections — doc/design/overview.html. Server components:
// they only render the view models from lib/data.
import Link from "next/link";
import { formatR, formatUsd, formatWhen, pairLabel } from "@/lib/data/format";
import type { AlertListItem, HeartbeatView, RiskView, ScoreRow } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { SideBadge, StatusBadge, StrategyBadge } from "@/components/alerts/badges";

/** Red-news banner (Unit 15). Renders nothing until news exists. */
export function NewsBannerSlot() {
  return null;
}

/** Risk guard: neutral until trades are logged; the drawdown maths is Unit 14. */
export function RiskGuardCard({ risk }: { risk: RiskView }) {
  return (
    <section aria-labelledby="risk" className="flex items-center gap-3 rounded-2xl border border-default bg-surface p-4">
      <span className="h-3 w-3 flex-none rounded-full bg-[var(--text-muted)]" aria-hidden="true" />
      <div className="flex-1">
        <h2 id="risk" className="text-base font-semibold">
          {risk.state === "none" ? "No trades logged yet" : `${risk.tradesLogged} trade${risk.tradesLogged === 1 ? "" : "s"} logged`}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted">
          {risk.state === "none"
            ? "The risk guard tracks your daily and overall drawdown once you log trades."
            : "Drawdown tracking starts when results are logged in the Journal."}
        </p>
      </div>
    </section>
  );
}

export function Scoreboard({ rows }: { rows: ScoreRow[] }) {
  return (
    <Link
      href="/strategies"
      className="flex flex-col gap-2.5 rounded-2xl border border-default bg-surface p-4 text-foreground no-underline"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Strategies · paper results</h2>
        <span className="text-[13px] font-medium text-accent">Manage</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No strategy is switched on.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => {
            const live = row.strategy.mode === "LIVE";
            return (
              <li key={row.strategy.id} className={cn("flex flex-col gap-0.5", !live && "opacity-72")}>
                <div className="flex items-center gap-2.5">
                  <StrategyBadge tag={row.strategy} />
                  <span className="min-w-0 flex-1 truncate text-sm">{row.strategy.name}</span>
                  <span
                    className={cn(
                      "w-16 text-right font-mono text-sm font-semibold",
                      !live ? "text-muted" : row.netUsd > 0 ? "text-buy" : row.netUsd < 0 ? "text-sell" : "text-muted",
                    )}
                  >
                    {formatUsd(row.netUsd)}
                  </span>
                </div>
                <p className="pl-[2px] font-mono text-xs text-muted">
                  {row.trades} trade{row.trades === 1 ? "" : "s"} · {row.wins} W / {row.losses} L
                  {row.winRate !== null && ` · ${Math.round(row.winRate * 100)}%`} · {formatR(row.netR)}
                  {row.early && ` · early ${row.closed}/30`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted">
        If every signal was taken. Win rate leaves out unresolved and not-filled trades. Early until 30 closed trades.
      </p>
    </Link>
  );
}

/** Rows like the design's latest-alerts list (whole row tappable). */
export function AlertRows({ items, now, empty }: { items: AlertListItem[]; now: Date; empty: string }) {
  if (items.length === 0) {
    return <p className="rounded-2xl border border-default bg-surface p-4 text-sm text-muted">{empty}</p>;
  }
  return (
    <div className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
      {items.map((a) => {
        const faded = a.status === "EXPIRED" || a.status === "SKIPPED";
        return (
          <Link
            key={a.id}
            href={`/alerts/${a.id}`}
            className="flex min-h-14 items-center gap-3 p-[14px] text-foreground no-underline active:bg-pressed"
          >
            <SideBadge direction={a.direction} />
            <div className="min-w-0 flex-1">
              <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 font-semibold", faded && "text-muted")}>
                {pairLabel(a.pair)}
                <StatusBadge status={a.status} test={a.isTest} />
                <StrategyBadge tag={a.strategy} />
              </p>
              <p className="mt-[3px] truncate text-[13px] text-muted">{a.reason}</p>
            </div>
            <span className="flex-none text-right font-mono text-[12px] text-muted">{formatWhen(a.time, now)}</span>
          </Link>
        );
      })}
    </div>
  );
}

const HEARTBEAT_DOT: Record<HeartbeatView["state"], string> = {
  ok: "bg-[var(--state-success)]",
  slow: "bg-accent",
  stopped: "bg-[var(--state-error)]",
  closed: "bg-[var(--text-muted)]",
  unknown: "bg-[var(--text-muted)]",
};

export function HeartbeatLine({ heartbeat }: { heartbeat: HeartbeatView }) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs",
        heartbeat.state === "slow" ? "text-accent" : heartbeat.state === "stopped" ? "text-error" : "text-muted",
      )}
    >
      <span className={cn("h-2 w-2 flex-none rounded-full", HEARTBEAT_DOT[heartbeat.state])} aria-hidden="true" />
      {heartbeat.text}
    </p>
  );
}
