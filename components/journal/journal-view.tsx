"use client";

// Journal — doc/design/journal.html. Two tabs: My trades (DG's own log, feeds
// the risk guard) and All signals (paper trades; never affect the guard).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { logResult, deleteEntry } from "@/lib/data/journal-actions";
import { formatDateTime, formatR, formatUsd, formatWhen, pairLabel } from "@/lib/data/format";
import { JOURNAL_PERIODS, PERIOD_LABEL } from "@/lib/data/journal-logic";
import type { JournalEntryView, JournalPageData, JournalPeriod, SignalsPageData } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { PaperBadge, StrategyBadge } from "@/components/alerts/badges";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { PendingButton } from "@/components/pending-button";
import { RiskGuardCard } from "@/components/risk/risk-guard-card";
import { useToast } from "@/components/toast";
import { TradeSheet } from "./trade-sheet";

type Tab = "mine" | "signals";

const chip = (on: boolean) =>
  cn(
    "h-9 flex-none rounded-[18px] border px-3.5 text-[13px] font-semibold",
    on ? "border-accent bg-accent text-on-accent" : "border-input bg-surface text-foreground",
  );

const sign = (n: number) => (n > 0 ? "text-buy" : n < 0 ? "text-sell" : "text-muted");

export function JournalView({ journal, signals, now }: { journal: JournalPageData; signals: SignalsPageData; now: string }) {
  const [tab, setTab] = useState<Tab>("mine");
  // #signals opens the second tab (links from Home / Strategies).
  useEffect(() => {
    const sync = () => setTab(window.location.hash === "#signals" ? "signals" : "mine");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  function pick(t: Tab) {
    setTab(t);
    history.replaceState(null, "", t === "signals" ? "#signals" : window.location.pathname + window.location.search);
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-surface p-1" role="group" aria-label="Journal view">
        {(
          [
            ["mine", "My trades"],
            ["signals", "All signals"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={tab === v}
            onClick={() => pick(v)}
            className={cn("h-[38px] rounded-lg text-sm font-semibold", tab === v ? "bg-accent text-on-accent" : "text-soft")}
          >
            {label}
          </button>
        ))}
      </div>

      <PeriodChips period={journal.period} tab={tab} />

      {tab === "mine" ? <MyTrades data={journal} now={new Date(now)} /> : <AllSignals data={signals} now={new Date(now)} />}
    </>
  );
}

function PeriodChips({ period, tab }: { period: JournalPeriod; tab: Tab }) {
  return (
    <nav className="-mx-4 flex gap-2 overflow-x-auto px-4" aria-label="Period">
      {JOURNAL_PERIODS.map((p) => (
        <Link
          key={p}
          href={`/journal?period=${p}${tab === "signals" ? "#signals" : ""}`}
          aria-current={p === period ? "page" : undefined}
          scroll={false}
          className={cn(chip(p === period), "inline-flex items-center no-underline")}
        >
          {PERIOD_LABEL[p]}
        </Link>
      ))}
    </nav>
  );
}

function ExportLink({ kind, period }: { kind: "trades" | "signals"; period: JournalPeriod }) {
  return (
    <a
      href={`/journal/export?kind=${kind}&period=${period}`}
      download
      className="flex h-11 items-center justify-center gap-2 rounded-xl border border-input text-sm font-semibold text-foreground no-underline"
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      Export CSV
    </a>
  );
}

// --- My trades ----------------------------------------------------------------

function MyTrades({ data, now }: { data: JournalPageData; now: Date }) {
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<{ entry: JournalEntryView | null } | null>(null);
  const [deleting, setDeleting] = useState<JournalEntryView | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const s = data.stats;

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const r = await deleteEntry(deleting.id);
      if (!r.ok) return setDeleteError(r.error);
      toast("Trade deleted. Risk guard updated.");
      setDeleting(null);
      setSheet(null);
      router.refresh();
    } catch {
      setDeleteError("Could not delete. Check your connection and try again.");
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="My trades">
      <RiskGuardCard guard={data.guard} />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Closed" value={String(s.trades)} />
        <Stat label="Win rate" value={s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`} />
        <Stat label="Net" value={formatR(s.netR)} tone={sign(s.netR)} sub={formatUsd(s.netUsd)} />
      </div>
      {s.trades > 0 && (
        <p className="-mt-2 font-mono text-xs text-muted">
          {s.wins} W / {s.losses} L{s.breakeven > 0 && ` / ${s.breakeven} BE`} · {s.pnlPct > 0 ? "+" : ""}
          {s.pnlPct.toFixed(2)}% of account
        </p>
      )}

      {data.open.map((e) => (
        <OpenTrade key={e.id} entry={e} now={now} />
      ))}

      <button
        type="button"
        onClick={() => setSheet({ entry: null })}
        className="flex h-[52px] items-center justify-center gap-2 rounded-xl border border-accent font-semibold text-accent"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        Add trade
      </button>

      {data.history.length === 0 ? (
        <p className="rounded-2xl border border-default bg-surface p-4 text-sm text-muted">
          No closed trades in this period.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
          {data.history.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setSheet({ entry: e })}
                aria-label={`Edit ${pairLabel(e.pair)} ${e.direction} trade`}
                className="flex min-h-14 w-full items-center gap-3 p-[14px] text-left active:bg-pressed"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 font-semibold">
                    {pairLabel(e.pair)}
                    <span className="text-[13px] font-medium text-muted">· {e.direction === "BUY" ? "Buy" : "Sell"}</span>
                    {e.strategy ? <StrategyBadge tag={e.strategy} /> : <span className="text-xs text-muted">manual</span>}
                  </p>
                  <p className="mt-[3px] font-mono text-xs text-muted">
                    {e.closedAt ? formatWhen(e.closedAt, now) : formatDateTime(e.openedAt)}
                    {e.note && ` · ${e.note}`}
                  </p>
                </div>
                <ResultBadge entry={e} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[13px] leading-normal text-muted">
        Log every trade you take and how it closed. The risk guard only knows what you log here. Tap a trade to edit or
        delete it.
      </p>
      <ExportLink kind="trades" period={data.period} />

      {sheet && (
        <TradeSheet
          key={sheet.entry?.id ?? "new"}
          open
          entry={sheet.entry}
          defaultRiskUsd={data.defaultRiskUsd}
          onClose={() => setSheet(null)}
          onSaved={(m) => {
            toast(`${m}. Risk guard updated.`);
            setSheet(null);
            router.refresh();
          }}
          onDelete={sheet.entry ? () => setDeleting(sheet.entry) : undefined}
        />
      )}
      <ConfirmSheet
        open={deleting !== null}
        title={deleting ? `Delete this ${pairLabel(deleting.pair)} trade?` : "Delete trade?"}
        confirmLabel="Delete trade"
        pending={deletePending}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
      >
        <p>It disappears from your journal and stops counting in the risk guard.</p>
        {deleteError && (
          <p role="alert" className="mt-2 text-error">
            {deleteError}
          </p>
        )}
      </ConfirmSheet>
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-default bg-surface p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className={cn("font-mono text-xl font-semibold", tone)}>{value}</span>
      {sub && <span className={cn("font-mono text-xs", tone)}>{sub}</span>}
    </div>
  );
}

function ResultBadge({ entry: e }: { entry: JournalEntryView }) {
  const base = "flex-none rounded-[10px] px-2.5 py-[3px] font-mono text-[11px] font-bold whitespace-nowrap";
  if (e.pnlUsd === null || e.resultR === null) return <span className={cn(base, "text-muted")}>—</span>;
  const tone = e.pnlUsd > 0 ? "bg-buy text-buy" : e.pnlUsd < 0 ? "bg-sell text-sell" : "border border-strong text-soft";
  return (
    <span className={cn(base, tone)}>
      {formatR(e.resultR)} · {formatUsd(e.pnlUsd)}
    </span>
  );
}

type Pick = "WIN" | "LOSS" | "BREAKEVEN" | "CUSTOM";

function OpenTrade({ entry: e, now }: { entry: JournalEntryView; now: Date }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<Pick | null>(null);
  const [ask, setAsk] = useState<"WIN" | "CUSTOM" | null>(null);
  const [value, setValue] = useState("3");
  const [error, setError] = useState<string | null>(null);

  async function log(result: Pick, extra: { r?: number; usd?: number } = {}) {
    setPending(result);
    setError(null);
    try {
      const r = await logResult(e.id, { result, ...extra });
      if (!r.ok) return setError(r.error);
      setAsk(null);
      toast("Logged. Risk guard updated.");
      router.refresh();
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  const parsed = Number(value.replace(/[,\s$]/g, ""));
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-default bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-1.5 font-semibold">
            {pairLabel(e.pair)}
            <span className="text-[13px] font-medium text-muted">· {e.direction === "BUY" ? "Buy" : "Sell"}</span>
            {e.strategy && <StrategyBadge tag={e.strategy} />}
          </p>
          <p className="mt-[3px] font-mono text-xs text-muted">
            {formatWhen(e.openedAt, now)} · {e.lots} lots · risk {formatUsd(e.riskUsd, { sign: false })}
          </p>
        </div>
        <span className="flex-none rounded-[10px] bg-accent px-2.5 py-[3px] text-[11px] font-bold text-on-accent">OPEN</span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-muted">How did it close?</span>
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ["WIN", "Win"],
              ["LOSS", "Loss"],
              ["BREAKEVEN", "BE"],
              ["CUSTOM", "Custom"],
            ] as const
          ).map(([v, label]) => (
            <PendingButton
              key={v}
              type="button"
              pending={pending === v}
              disabled={pending !== null}
              onClick={() => {
                setError(null);
                if (v === "WIN" || v === "CUSTOM") {
                  setValue(v === "WIN" ? "3" : "");
                  setAsk(v);
                } else void log(v);
              }}
              className="h-11 rounded-lg border border-input text-sm font-semibold"
            >
              {label}
            </PendingButton>
          ))}
        </div>
      </div>
      {error && !ask && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <ConfirmSheet
        open={ask !== null}
        title={ask === "WIN" ? `Win on ${pairLabel(e.pair)}` : `Custom result on ${pairLabel(e.pair)}`}
        confirmLabel={ask === "WIN" ? "Log win" : "Log result"}
        pending={pending !== null}
        onConfirm={() => {
          if (!Number.isFinite(parsed) || value.trim() === "") return setError("Enter a number.");
          void log(ask!, ask === "WIN" ? { r: parsed } : { usd: parsed });
        }}
        onCancel={() => {
          setAsk(null);
          setError(null);
        }}
      >
        <label className="flex items-center justify-between gap-3">
          {ask === "WIN" ? "R won (risk × R)" : "Result in USD, fees included (use − for a loss)"}
          <input
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            className="h-11 w-28 rounded-lg border border-input bg-base px-2.5 text-right font-mono"
          />
        </label>
        {ask === "WIN" && Number.isFinite(parsed) && parsed > 0 && (
          <p className="mt-2 font-mono text-xs text-muted">
            = {formatUsd(Math.round(e.riskUsd * parsed * 100) / 100)} on {formatUsd(e.riskUsd, { sign: false })} risk
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-error">
            {error}
          </p>
        )}
      </ConfirmSheet>
    </section>
  );
}

// --- All signals --------------------------------------------------------------

function AllSignals({ data, now }: { data: SignalsPageData; now: Date }) {
  const [filter, setFilter] = useState<string | null>(null);
  const list = filter ? data.signals.filter((s) => s.strategy.id === filter) : data.signals;
  const t = data.totals;
  const allEarly = data.comparison.every((c) => c.row.early);
  return (
    <section className="flex flex-col gap-4" aria-label="All signals">
      <div className="overflow-x-auto rounded-2xl border border-default bg-surface">
        <table className="w-full min-w-[420px] border-collapse text-[13px]">
          <caption className="px-3.5 pt-3.5 pb-1.5 text-left text-xs font-semibold tracking-[0.06em] text-muted uppercase">
            Compare · {PERIOD_LABEL[data.period].toLowerCase()}, if every signal taken
          </caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="px-3.5 py-2 font-medium">Strategy</th>
              <th scope="col" className="px-1 py-2 font-medium">Closed</th>
              <th scope="col" className="px-1 py-2 font-medium">W / L</th>
              <th scope="col" className="px-1 py-2 font-medium">Win %</th>
              <th scope="col" className="px-1 py-2 font-medium" title="Worst losing streak">Streak</th>
              <th scope="col" className="px-1 py-2 font-medium" title="Unresolved / not filled">U / NF</th>
              <th scope="col" className="px-3.5 py-2 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {data.comparison.map(({ strategy, row }) => (
              <tr key={strategy.id} className={cn("border-t border-default", strategy.mode !== "LIVE" && "opacity-72")}>
                <td className="px-3.5 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <StrategyBadge tag={strategy} />
                    {row.early && <span className="font-sans text-[11px] text-muted">early</span>}
                  </span>
                </td>
                <td className="px-1 py-2.5">{row.closed}</td>
                <td className="px-1 py-2.5">
                  {row.wins} / {row.losses}
                </td>
                <td className="px-1 py-2.5">{row.winRate === null ? "—" : `${Math.round(row.winRate * 100)}%`}</td>
                <td className="px-1 py-2.5">{row.worstLosingStreak}</td>
                <td className="px-1 py-2.5">
                  {row.unresolved} / {row.notFilled}
                </td>
                <td className={cn("px-3.5 py-2.5 text-right whitespace-nowrap", sign(row.netR))}>
                  {formatR(row.netR)} · {formatUsd(row.netUsd)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-strong font-semibold">
              <td className="px-3.5 py-2.5 font-sans">All</td>
              <td className="px-1 py-2.5">{t.closed}</td>
              <td className="px-1 py-2.5">
                {t.wins} / {t.losses}
              </td>
              <td className="px-1 py-2.5">{t.winRate === null ? "—" : `${Math.round(t.winRate * 100)}%`}</td>
              <td className="px-1 py-2.5" />
              <td className="px-1 py-2.5">
                {t.unresolved} / {t.notFilled}
              </td>
              <td className={cn("px-3.5 py-2.5 text-right whitespace-nowrap", sign(t.netR))}>
                {formatR(t.netR)} · {formatUsd(t.netUsd)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="px-3.5 pt-1 pb-3.5 text-xs text-muted">
          {allEarly
            ? "All early: under 30 closed trades each. Don't pick a winner yet."
            : "Early = under 30 closed trades. Win rate leaves out unresolved and not-filled trades."}
        </p>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Show signals from">
        <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)} className={chip(filter === null)}>
          All
        </button>
        {data.strategies.map((s) => (
          <button key={s.id} type="button" aria-pressed={filter === s.id} onClick={() => setFilter(s.id)} className={chip(filter === s.id)}>
            {s.code}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="rounded-2xl border border-default bg-surface p-4 text-sm text-muted">No signals in this period.</p>
      ) : (
        <div className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
          {list.map((s) => (
            <Link
              key={s.id}
              href={`/alerts/${s.id}`}
              className="flex min-h-14 items-center gap-3 p-[14px] text-foreground no-underline active:bg-pressed"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {pairLabel(s.pair)}{" "}
                  <span className="text-[13px] font-medium text-muted">
                    · {s.direction === "BUY" ? "Buy" : "Sell"} ·{" "}
                    {s.decision === "taken" ? "you took it" : s.decision === "skipped" ? "skipped" : "not marked"}
                  </span>
                </p>
                <p className="mt-[3px] flex items-center gap-1.5 font-mono text-xs text-muted">
                  {formatWhen(s.readyAt, now)} <StrategyBadge tag={s.strategy} testPrefix />
                </p>
              </div>
              {s.paper && <PaperBadge paper={s.paper} prefix="" />}
            </Link>
          ))}
        </div>
      )}

      <p className="text-[13px] leading-normal text-muted">
        Paper results assume entry at the alert price with no spread or commission. Real results will be a little
        worse. These never affect your risk guard.
      </p>
      <ExportLink kind="signals" period={data.period} />
    </section>
  );
}
