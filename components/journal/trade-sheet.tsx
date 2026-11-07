"use client";

// Add or edit a journal trade (bottom sheet). Risk is pre-filled from
// Settings and lots are suggested from entry, stop and risk.
import { useEffect, useState } from "react";
import { addManualTrade, editEntry } from "@/lib/data/journal-actions";
import type { JournalEntryView } from "@/lib/data/types";
import { suggestLots } from "@/lib/risk/lots";
import type { Direction, Pair } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PendingButton } from "@/components/pending-button";

const PAIRS: Pair[] = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"];
type Result = "WIN" | "LOSS" | "BREAKEVEN" | "CUSTOM";

interface Draft {
  pair: Pair;
  direction: Direction;
  entry: string;
  stop: string;
  target: string;
  lots: string;
  riskUsd: string;
  note: string;
  result: Result;
  r: string;
  usd: string;
}

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s.replace(/[,\s$]/g, "")));

export function TradeSheet({
  open,
  entry,
  defaultRiskUsd,
  onClose,
  onSaved,
  onDelete,
}: {
  open: boolean;
  /** Editing this entry; null = a new manual trade. */
  entry: JournalEntryView | null;
  defaultRiskUsd: number;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Editing only: asks to delete (the parent confirms). */
  onDelete?: () => void;
}) {
  const blank: Draft = {
    pair: "EUR_USD",
    direction: "BUY",
    entry: "",
    stop: "",
    target: "",
    lots: "",
    riskUsd: String(defaultRiskUsd),
    note: "",
    result: "WIN",
    r: "3",
    usd: "",
  };
  const fromEntry = (e: JournalEntryView): Draft => ({
    pair: e.pair,
    direction: e.direction,
    entry: String(e.entry),
    stop: String(e.stop),
    target: String(e.target),
    lots: String(e.lots),
    riskUsd: String(e.riskUsd),
    note: e.note ?? "",
    result: e.result ?? "WIN",
    r: e.resultR !== null && e.result === "WIN" ? String(e.resultR) : "3",
    usd: e.pnlUsd !== null ? String(e.pnlUsd) : "",
  });
  const [d, setD] = useState<Draft>(entry ? fromEntry(entry) : blank);
  const [lotsTouched, setLotsTouched] = useState(Boolean(entry));
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Suggest lots from entry / stop / risk until DG types his own.
  useEffect(() => {
    if (lotsTouched) return;
    const lots = suggestLots(d.pair, num(d.entry), num(d.stop), num(d.riskUsd));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (lots !== null) setD((x) => ({ ...x, lots: lots.toFixed(2) }));
  }, [d.pair, d.entry, d.stop, d.riskUsd, lotsTouched]);

  if (!open) return null;
  const closed = entry?.status === "CLOSED";
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => {
    if (k === "lots") setLotsTouched(true);
    setD((x) => ({ ...x, [k]: e.target.value }));
  };

  async function save() {
    setPending(true);
    setError(null);
    setErrors({});
    const trade = {
      pair: d.pair,
      direction: d.direction,
      entry: num(d.entry),
      stop: num(d.stop),
      target: num(d.target),
      lots: num(d.lots),
      riskUsd: num(d.riskUsd),
      ...(d.note.trim() && { note: d.note.trim() }),
    };
    try {
      const result = entry
        ? await editEntry(entry.id, {
            trade,
            ...(closed && {
              result: { result: d.result, ...(d.result === "WIN" && { r: num(d.r) }), ...(d.result === "CUSTOM" && { usd: num(d.usd) }) },
            }),
          })
        : await addManualTrade(trade);
      if (!result.ok) {
        setError(result.error);
        if ("fieldErrors" in result && result.fieldErrors) {
          setErrors(Object.fromEntries(result.fieldErrors.map((f) => [f.path.replace(/^(trade|result)\./, ""), f.message])));
        }
        return;
      }
      onSaved(entry ? "Trade updated" : "Trade added");
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  const field = (k: "entry" | "stop" | "target" | "lots" | "riskUsd", label: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input
        inputMode="decimal"
        value={d[k]}
        onChange={set(k)}
        aria-invalid={errors[k] ? true : undefined}
        className={cn("h-11 rounded-lg border bg-base px-3 font-mono text-sm", errors[k] ? "border-[var(--state-error)]" : "border-input")}
      />
      {errors[k] && <span className="text-xs text-error">{errors[k]}</span>}
    </label>
  );

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-backdrop" onClick={() => !pending && onClose()} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-title"
        className="fixed inset-x-0 bottom-0 z-[71] mx-auto flex max-h-[88dvh] max-w-[480px] flex-col gap-3 overflow-y-auto rounded-t-[20px] border-t border-default bg-surface px-4 pt-5 pb-[calc(24px+env(safe-area-inset-bottom))]"
      >
        <h2 id="trade-title" className="text-lg font-semibold">
          {entry ? "Edit trade" : "Add a trade"}
        </h2>
        {!entry && <p className="text-[13px] text-muted">For a trade you took outside the app. It counts in your risk guard.</p>}
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Pair</span>
            <select value={d.pair} onChange={set("pair")} className="h-11 rounded-lg border border-input bg-base px-2 text-sm">
              {PAIRS.map((p) => (
                <option key={p} value={p}>
                  {p.replace("_", "/")}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Direction</span>
            <div className="grid h-11 grid-cols-2 gap-1 rounded-lg bg-base p-1" role="group" aria-label="Direction">
              {(["BUY", "SELL"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={d.direction === v}
                  onClick={() => setD((x) => ({ ...x, direction: v }))}
                  className={cn("rounded-md text-[13px] font-bold", d.direction === v ? (v === "BUY" ? "bg-buy text-buy" : "bg-sell text-sell") : "text-soft")}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          {field("entry", "Entry")}
          {field("stop", "Stop")}
          {field("target", "Target")}
          {field("riskUsd", "Risk (USD)")}
          {field("lots", "Lots")}
        </div>
        {closed && (
          <div className="flex flex-col gap-2 rounded-xl bg-base p-3">
            <span className="text-sm text-muted">Result</span>
            <div className="grid grid-cols-4 gap-1" role="group" aria-label="Result">
              {(["WIN", "LOSS", "BREAKEVEN", "CUSTOM"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={d.result === v}
                  onClick={() => setD((x) => ({ ...x, result: v }))}
                  className={cn("h-9 rounded-md text-xs font-semibold", d.result === v ? "bg-accent text-on-accent" : "border border-input")}
                >
                  {v === "BREAKEVEN" ? "BE" : v[0] + v.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            {d.result === "WIN" && (
              <label className="flex items-center justify-between gap-3 text-sm">
                R won
                <input inputMode="decimal" value={d.r} onChange={set("r")} className="h-10 w-24 rounded-lg border border-input bg-surface px-2.5 text-right font-mono" />
              </label>
            )}
            {d.result === "CUSTOM" && (
              <label className="flex items-center justify-between gap-3 text-sm">
                Result in USD (fees included)
                <input inputMode="decimal" value={d.usd} onChange={set("usd")} className="h-10 w-28 rounded-lg border border-input bg-surface px-2.5 text-right font-mono" />
              </label>
            )}
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Note (optional)</span>
          <input value={d.note} onChange={set("note")} maxLength={500} className="h-11 rounded-lg border border-input bg-base px-3 text-sm" />
        </label>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <div className="flex gap-2.5">
          <button type="button" onClick={onClose} disabled={pending} className="h-[52px] flex-1 rounded-xl border border-input font-semibold">
            Cancel
          </button>
          <PendingButton type="button" pending={pending} pendingLabel="Saving…" onClick={save} className="h-[52px] flex-[2] rounded-xl bg-accent font-bold text-on-accent">
            {entry ? "Save changes" : "Add trade"}
          </PendingButton>
        </div>
        {entry && onDelete && (
          <button type="button" onClick={onDelete} disabled={pending} className="h-11 text-sm font-semibold text-error">
            Delete this trade
          </button>
        )}
      </div>
    </>
  );
}
