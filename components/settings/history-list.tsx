"use client";

// Change history rows — doc/design/settings-history.html. Restore goes
// through restoreSettings (a new version, so a restore can be undone).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { restoreSettings } from "@/lib/data/settings-actions";
import { formatDateTime } from "@/lib/data/format";
import type { HistoryRow } from "@/lib/data/types";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useToast } from "@/components/toast";

const SHOWN = 4;

function ChangeLines({ row }: { row: HistoryRow }) {
  const [all, setAll] = useState(false);
  if (row.changes.length === 0) {
    return <p className="text-sm text-check">{row.by === "system" ? "First setup: the settings at that time" : "No changes recorded"}</p>;
  }
  const shown = all ? row.changes : row.changes.slice(0, SHOWN);
  return (
    <>
      {shown.map((c, i) => (
        <p key={i} className="text-sm text-check">
          {c.field}{" "}
          <span className="font-mono text-[13px]">
            {c.from} → {c.to}
          </span>
        </p>
      ))}
      {!all && row.changes.length > SHOWN && (
        <button type="button" onClick={() => setAll(true)} className="self-start text-xs text-muted underline">
          +{row.changes.length - SHOWN} more change{row.changes.length - SHOWN === 1 ? "" : "s"}
        </button>
      )}
    </>
  );
}

export function HistoryList({ rows, versionId }: { rows: HistoryRow[]; versionId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<HistoryRow | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ text: string; stale?: boolean } | null>(null);

  async function restore(row: HistoryRow) {
    setPending(true);
    setError(null);
    try {
      const result = await restoreSettings(row.id, versionId);
      if (!result.ok) {
        setError({ text: result.error, stale: result.stale });
        return;
      }
      if ("noChanges" in result) {
        toast("No changes: those values are already in use");
        return;
      }
      toast("Restored. Applies from the next scan.", { href: `/settings/history#v-${result.versionId}`, label: "See it" });
      router.refresh();
    } catch {
      setError({ text: "Could not restore. Check your connection and try again." });
    } finally {
      setPending(false);
      setConfirm(null);
    }
  }

  return (
    <>
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
      <ol className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
        {rows.map((row) => (
          <li key={row.id} id={`v-${row.id}`} className="flex scroll-mt-4 flex-col gap-2 p-[14px]">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs text-muted">
                {formatDateTime(row.createdAt)} · {row.by}
              </p>
              {row.current && <span className="rounded-[10px] bg-accent px-2.5 py-[3px] text-[11px] font-bold text-on-accent">CURRENT</span>}
            </div>
            {row.restoredFrom && (
              <p className="text-xs text-muted">
                Restored from {row.restoredFrom.createdAt ? formatDateTime(row.restoredFrom.createdAt) : "an older version"}
              </p>
            )}
            <ChangeLines row={row} />
            {!row.current && (
              <button
                type="button"
                onClick={() => setConfirm(row)}
                className="h-10 self-start rounded-xl border border-input px-[18px] text-sm font-semibold"
              >
                Restore
              </button>
            )}
          </li>
        ))}
      </ol>
      <ConfirmSheet
        open={confirm !== null}
        title={`Restore ${confirm ? formatDateTime(confirm.createdAt) : ""}?`}
        confirmLabel="Restore"
        pending={pending}
        onConfirm={() => confirm && void restore(confirm)}
        onCancel={() => setConfirm(null)}
      >
        {confirm && (
          <div className="flex flex-col gap-1.5">
            {confirm.restorePreview.length === 0 ? (
              <p>Those values are already in use: nothing would change.</p>
            ) : (
              <>
                <p>This will change:</p>
                {confirm.restorePreview.map((c, i) => (
                  <p key={i} className="text-check">
                    {c.field}{" "}
                    <span className="font-mono text-[13px]">
                      {c.from} → {c.to}
                    </span>
                  </p>
                ))}
              </>
            )}
            <p className="mt-1 text-xs text-muted">The restore is saved as a new version, so you can undo it too.</p>
          </div>
        )}
      </ConfirmSheet>
    </>
  );
}
