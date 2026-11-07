"use client";

// Watchlist rows — doc/design/watchlist.html. Each switch saves through
// setPairEnabled (saveSettings: one transaction + a history version).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setPairEnabled } from "@/lib/data/settings-actions";
import type { Trend, WatchlistRow } from "@/lib/data/types";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ToggleSwitch } from "@/components/toggle-switch";
import { useToast } from "@/components/toast";

const NAMES: Record<string, string> = { XAU_USD: "Gold (XAU/USD)" };
const trendWord = (t: Trend) => (t === "UP" ? "up" : t === "DOWN" ? "down" : "ranging");

function bias(row: WatchlistRow): string {
  const aligned = row.trendD === row.trendH4 && row.trendD !== "RANGE";
  return `Daily ${trendWord(row.trendD)} · 4H ${trendWord(row.trendH4)} · ${aligned ? "aligned" : "no trade"}`;
}

export function WatchlistRows({ rows: initialRows, versionId: initialVersion }: { rows: WatchlistRow[]; versionId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [versionId, setVersionId] = useState(initialVersion);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<WatchlistRow | null>(null);
  const [error, setError] = useState<{ text: string; stale?: boolean } | null>(null);

  async function apply(row: WatchlistRow, enabled: boolean) {
    setBusy(row.pair);
    setError(null);
    try {
      const result = await setPairEnabled(row.pair, enabled, versionId);
      if (!result.ok) {
        setError({ text: result.error, stale: result.stale });
        return;
      }
      if ("noChanges" in result) return;
      setRows((rs) => rs.map((r) => (r.pair === row.pair ? { ...r, enabled } : r)));
      setVersionId(result.versionId);
      toast("Saved. Applies from the next scan.");
      router.refresh();
    } catch {
      setError({ text: "Could not save. Check your connection and try again." });
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  return (
    <>
      <p className="-mt-2 text-[13px] text-muted">
        Watching {rows.filter((r) => r.enabled).length} of {rows.length} markets
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
      <div className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
        {rows.map((row) => (
          <div key={row.pair} className="flex min-h-14 items-center gap-3 p-[14px]">
            <Link href={`/chart?pair=${row.pair}`} className="min-w-0 flex-1 text-foreground no-underline">
              <p className="text-base font-semibold">{NAMES[row.pair] ?? row.pair.replace("_", "/")}</p>
              <p className="mt-1 text-[13px] text-muted">
                {bias(row)}
                {row.openPaperTrades > 0 && ` · ${row.openPaperTrades} open paper trade${row.openPaperTrades === 1 ? "" : "s"}`}
              </p>
            </Link>
            <ToggleSwitch
              checked={row.enabled}
              disabled={busy !== null}
              label={`Watch ${row.pair.replace("_", "/")}`}
              onChange={(on) => {
                if (!on && row.openPaperTrades > 0) setConfirm(row);
                else void apply(row, on);
              }}
            />
          </div>
        ))}
      </div>
      <ConfirmSheet
        open={confirm !== null}
        title={`Stop watching ${confirm ? (NAMES[confirm.pair] ?? confirm.pair.replace("_", "/")) : ""}?`}
        confirmLabel="Switch off"
        pending={busy !== null}
        onConfirm={() => confirm && void apply(confirm, false)}
        onCancel={() => setConfirm(null)}
      >
        <p>Open paper trades on this pair will still be tracked until they close. No new setups are looked for.</p>
      </ConfirmSheet>
    </>
  );
}
