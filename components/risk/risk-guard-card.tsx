// The risk guard (doc/design/overview.html): a state banner, and in the full
// version the today / overall meters, open risk and the reasons. Built only
// from DG's own journal entries.
import Link from "next/link";
import type { RiskGuardView } from "@/lib/data/types";
import { cn } from "@/lib/utils";

const STATE_STYLE: Record<RiskGuardView["state"], { box: string; dot: string; title: string }> = {
  cleared: { box: "border-notice-ok bg-notice-ok text-notice-ok", dot: "bg-[var(--state-success)]", title: "text-foreground" },
  warning: { box: "border-accent bg-warn text-accent-soft", dot: "bg-accent", title: "text-accent" },
  stopped: { box: "border-[var(--trade-sell)] bg-sell text-sell", dot: "bg-[var(--trade-sell)]", title: "text-sell" },
  breached: { box: "border-[var(--state-error)] bg-sell text-error", dot: "bg-[var(--state-error)]", title: "text-error" },
};

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}%`;

function Meter({ label, pct, marks, limit }: { label: string; pct: number; marks: Array<{ at: number; label: string }>; limit: number }) {
  const down = Math.max(0, -pct);
  const fill = Math.min(100, (down / limit) * 100);
  const reached = marks.filter((m) => down >= m.at).length;
  const color = reached >= 2 ? "bg-[var(--state-error)]" : reached === 1 ? "bg-accent" : "bg-[var(--text-muted)]";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span>{label}</span>
        <span className={cn("font-mono text-lg font-semibold", pct < 0 && reached > 0 ? "text-accent" : "")}>{signed(pct)}</span>
      </div>
      <div
        className="relative h-2 rounded bg-[var(--border-default)]"
        role="img"
        aria-label={`${label}: ${signed(pct)}. ${marks.map((m) => `${m.label} at ${m.at}%`).join(", ")}, limit ${limit}%.`}
      >
        <div className={cn("h-2 rounded", color)} style={{ width: `${fill}%` }} />
        {marks.map((m) => (
          <div key={m.label} className="absolute -top-1 h-4 w-0.5 bg-foreground" style={{ left: `${Math.min(100, (m.at / limit) * 100)}%` }} />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span>0%</span>
        {marks.map((m) => (
          <span key={m.label}>
            {m.label} {m.at}%
          </span>
        ))}
        <span>Limit {limit}%</span>
      </div>
    </div>
  );
}

export function RiskGuardCard({ guard: g, variant = "full", link }: { guard: RiskGuardView; variant?: "full" | "banner"; link?: string }) {
  const style = STATE_STYLE[g.state];
  const banner = (
    <section aria-label="Risk guard" className={cn("flex items-center gap-3 rounded-2xl border p-4", style.box)}>
      <span className={cn("h-3 w-3 flex-none rounded-full", style.dot)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn("text-base font-semibold", style.title)}>{g.title}</p>
        <p className="mt-0.5 text-[13px]">
          {g.tradesToday} of {g.maxTradesPerDay} trades today · {g.usdExposure.text}
        </p>
        {variant === "banner" && g.reasons[0] && <p className="mt-1 text-[13px]">{g.reasons[0]}</p>}
      </div>
    </section>
  );
  if (variant === "banner") {
    return link ? (
      <Link href={link} className="no-underline">
        {banner}
      </Link>
    ) : (
      banner
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {banner}
      <section className="flex flex-col gap-3.5 rounded-2xl border border-default bg-surface p-4">
        <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Risk guard</h2>
        <Meter
          label="Today"
          pct={g.todayPct}
          limit={g.limits.dailyLossLimitPct}
          marks={[
            { at: g.limits.warnDailyLossPct, label: "Warn" },
            { at: g.limits.stopDailyLossPct, label: "Stop" },
          ]}
        />
        <Meter label="Overall drawdown" pct={g.overallPct} limit={g.limits.maxDrawdownPct} marks={[{ at: g.limits.warnOverallLossPct, label: "Warn" }]} />
        <dl className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-[3px] rounded-[10px] bg-base p-2.5">
            <dt className="text-xs text-muted">Open risk</dt>
            <dd className="font-mono text-sm font-semibold">
              ${g.openRiskUsd.toFixed(2)} · {g.openTrades} open
            </dd>
          </div>
          <div className="flex flex-col gap-[3px] rounded-[10px] bg-base p-2.5">
            <dt className="text-xs text-muted">Worst case today</dt>
            <dd className={cn("font-mono text-sm font-semibold", g.worstCaseTodayPct <= -g.limits.stopDailyLossPct && "text-sell")}>
              {signed(g.worstCaseTodayPct)}
            </dd>
          </div>
        </dl>
        {g.reasons.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-check">
            {g.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">
          Based only on trades you log here. The app isn&apos;t connected to your broker. Paper trades never count.
        </p>
      </section>
    </div>
  );
}
