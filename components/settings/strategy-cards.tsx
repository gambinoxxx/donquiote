"use client";

// Strategy cards — doc/design/strategies.html. Mode changes save through
// setStrategyMode (saveSettings: one transaction + a history version).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setStrategyMode } from "@/lib/data/settings-actions";
import { formatR, formatUsd } from "@/lib/data/format";
import type { StrategyCard, StrategyMode } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { StrategyBadge } from "@/components/alerts/badges";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useToast } from "@/components/toast";

const EARLY_UNTIL = 30;
const MODES: ReadonlyArray<{ value: StrategyMode; label: string }> = [
  { value: "LIVE", label: "Live" },
  { value: "TEST", label: "Test" },
  { value: "OFF", label: "Off" },
];
export const LAST_LIVE_MESSAGE = "At least one strategy must stay Live.";

export function StrategyCards({ strategies: initial, versionId: initialVersion }: { strategies: StrategyCard[]; versionId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [strategies, setStrategies] = useState(initial);
  const [versionId, setVersionId] = useState(initialVersion);
  const [pending, setPending] = useState<string | null>(null);
  const [goLive, setGoLive] = useState<StrategyCard | null>(null);
  const [rules, setRules] = useState<StrategyCard | null>(null);
  const [error, setError] = useState<{ text: string; stale?: boolean } | null>(null);

  const liveCount = strategies.filter((s) => s.mode === "LIVE").length;

  async function change(s: StrategyCard, mode: StrategyMode) {
    setPending(s.id);
    setError(null);
    try {
      const result = await setStrategyMode(s.id, mode, versionId);
      if (!result.ok) {
        setError({ text: result.error, stale: result.stale });
        return;
      }
      if ("noChanges" in result) return;
      setStrategies((list) => list.map((x) => (x.id === s.id ? { ...x, mode } : x)));
      setVersionId(result.versionId);
      toast(`${s.name} is now ${mode === "LIVE" ? "Live" : mode === "TEST" ? "Test" : "Off"}. Applies from the next scan.`);
      router.refresh();
    } catch {
      setError({ text: "Could not save. Check your connection and try again." });
    } finally {
      setPending(null);
      setGoLive(null);
    }
  }

  function choose(s: StrategyCard, mode: StrategyMode) {
    if (mode === s.mode || pending) return;
    if (s.mode === "LIVE" && liveCount === 1) {
      setError({ text: LAST_LIVE_MESSAGE });
      toast(LAST_LIVE_MESSAGE);
      return;
    }
    if (mode === "LIVE") {
      setGoLive(s);
      return;
    }
    void change(s, mode);
  }

  const otherLive = goLive ? strategies.filter((x) => x.mode === "LIVE" && x.id !== goLive.id).map((x) => x.name) : [];
  return (
    <>
      <p className="-mt-2 text-[13px] text-muted">
        {liveCount} live · {strategies.filter((s) => s.mode === "TEST").length} testing
      </p>
      <p className="rounded-xl border border-notice-ok bg-notice-ok px-3.5 py-3 text-[13px] text-notice-ok">
        <b className="text-foreground">Live</b> strategies send alerts. <b className="text-foreground">Test</b> strategies run silently and
        record paper trades. Results are marked <b className="text-foreground">early</b> until a strategy has 30 closed paper trades. Don&apos;t
        judge it before then.
      </p>
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-[var(--state-error)] px-3.5 py-2.5 text-sm text-error">
          <span>{error.text}</span>
          {error.stale && (
            <button type="button" onClick={() => window.location.reload()} className="font-semibold underline">
              Reload
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {strategies.map((s) => {
          const p = s.paper;
          const pct = Math.min(100, Math.round((p.closed / EARLY_UNTIL) * 100));
          return (
            <article
              key={s.id}
              aria-labelledby={`s-${s.id}`}
              className={cn(
                "flex flex-col gap-3 rounded-2xl border border-default bg-surface p-4",
                s.mode === "TEST" && "border-dashed opacity-72",
                s.mode === "OFF" && "opacity-50",
              )}
            >
              <div className="flex items-start gap-2.5">
                <StrategyBadge tag={{ id: s.id, code: s.code, name: s.name, mode: s.mode }} />
                <div className="min-w-0 flex-1">
                  <h2 id={`s-${s.id}`} className="text-base font-semibold">
                    {s.name}
                  </h2>
                  <p className="mt-[3px] text-[13px] leading-[1.45] text-muted">{s.description}</p>
                </div>
              </div>

              <div className="inline-flex gap-1 self-start rounded-[10px] bg-base p-[3px]" role="group" aria-label={`${s.name} mode`}>
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={s.mode === m.value}
                    disabled={pending !== null}
                    onClick={() => choose(s, m.value)}
                    className={cn(
                      "h-[34px] min-w-[52px] rounded-lg px-2.5 font-mono text-[13px] font-semibold disabled:opacity-60",
                      s.mode === m.value ? "bg-accent text-on-accent" : "text-soft",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted">Closed paper trades</span>
                  <span className="font-mono">
                    {p.closed} / {EARLY_UNTIL}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-[3px] bg-[var(--border-default)]" role="img" aria-label={`${p.closed} of 30 closed paper trades`}>
                  <i className="block h-full rounded-[3px] bg-[var(--text-muted)]" style={{ width: `${pct}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-[3px] rounded-[10px] bg-base p-2.5">
                  <span className="text-xs text-muted">Paper so far</span>
                  <span className="font-mono text-[13px] font-semibold">
                    {formatR(p.netR)} · {formatUsd(p.netUsd)}
                    {p.early && <span className="ml-1 font-sans text-[11px] font-medium text-muted">early</span>}
                  </span>
                </div>
                <div className="flex flex-col gap-[3px] rounded-[10px] bg-base p-2.5">
                  <span className="text-xs text-muted">Trades · W / L</span>
                  <span className="font-mono text-[13px] font-semibold">
                    {p.trades} · {p.wins} / {p.losses}
                    {p.winRate !== null && <span className="text-muted"> · {Math.round(p.winRate * 100)}%</span>}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "rounded-[10px] px-[9px] py-[3px] text-[11px] font-bold",
                    p.early ? "bg-skeleton text-soft" : "bg-buy text-buy",
                  )}
                >
                  {p.early ? "Collecting data" : "Ready to review"}
                </span>
                <span className="text-xs text-muted">
                  worst streak {s.worstLosingStreak}
                  {p.unresolved + p.notFilled > 0 && ` · ${p.unresolved} unresolved · ${p.notFilled} not filled`}
                </span>
              </div>

              <button type="button" onClick={() => setRules(s)} className="flex min-h-8 items-center self-start text-sm font-semibold text-accent">
                Rules · {s.id}
              </button>
            </article>
          );
        })}
      </div>

      <p className="text-xs leading-normal text-muted">
        If more than one strategy is live and they see the same setup (same pair and direction within 30 min), you get one alert tagged with
        all of them. Paper results assume entry at the alert price with no spread or commission. Past results don&apos;t guarantee future ones.
      </p>

      <ConfirmSheet
        open={goLive !== null}
        title={`Make ${goLive?.name ?? ""} live?`}
        confirmLabel="Make live"
        pending={pending !== null}
        onConfirm={() => goLive && void change(goLive, "LIVE")}
        onCancel={() => setGoLive(null)}
      >
        {goLive && (
          <div className="flex flex-col gap-2.5">
            <p>
              Live strategies send push and email{otherLive.length > 0 ? `, alongside ${otherLive.join(" and ")}` : ""}. Paper so far:{" "}
              {goLive.paper.trades} trades ({goLive.paper.wins} W / {goLive.paper.losses} L
              {goLive.paper.winRate !== null ? `, ${Math.round(goLive.paper.winRate * 100)}%` : ""}), {formatR(goLive.paper.netR)} ·{" "}
              {formatUsd(goLive.paper.netUsd)}, worst streak {goLive.worstLosingStreak}.
            </p>
            {goLive.paper.closed < EARLY_UNTIL && (
              <p className="rounded-xl bg-warn px-3.5 py-3 text-[13px] text-accent-soft">
                Only {goLive.paper.closed} paper trade{goLive.paper.closed === 1 ? "" : "s"} so far. Results this early can be luck.
              </p>
            )}
            <p className="text-xs text-muted">Saved to Change history. You can undo it any time.</p>
          </div>
        )}
      </ConfirmSheet>

      {rules && (
        <>
          <div className="fixed inset-0 z-[70] bg-backdrop" onClick={() => setRules(null)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-title"
            className="fixed inset-x-0 bottom-0 z-[71] mx-auto flex max-h-[80dvh] max-w-[480px] flex-col gap-3 overflow-y-auto rounded-t-[20px] border-t border-default bg-surface px-4 pt-5 pb-[calc(28px+env(safe-area-inset-bottom))]"
          >
            <h2 id="rules-title" className="text-lg font-semibold">
              {rules.name} · rules
            </h2>
            <ol className="list-decimal pl-[18px] text-sm leading-[1.55] text-check">
              {rules.rules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
            <p className="text-xs text-muted">
              Rules can&apos;t be edited in the app: a change in rules is a new strategy version in code.
            </p>
            <button type="button" onClick={() => setRules(null)} className="h-[52px] rounded-xl border border-input font-semibold" autoFocus>
              Close
            </button>
          </div>
        </>
      )}
    </>
  );
}
