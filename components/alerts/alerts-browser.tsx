"use client";

// Alerts list: status chips, "Show test signals" (remembered on this
// device), Load more. The first page comes from the server; later pages and
// filter changes go through the loadAlerts server action.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadAlerts } from "@/lib/data/actions";
import type { AlertListItem, AlertPage, StatusFilter } from "@/lib/data/types";
import type { Pair } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PendingButton } from "@/components/pending-button";
import { AlertCardsSkeleton } from "@/components/skeletons/alerts";
import { readShowTest, saveShowTest } from "@/components/show-test-signals";
import { ToggleSwitch } from "@/components/toggle-switch";
import { AlertCard } from "./alert-card";

const CHIPS: ReadonlyArray<{ value: StatusFilter; label: string; empty: string }> = [
  { value: "all", label: "All", empty: "No alerts yet. They appear here as soon as the scanner finds a setup." },
  { value: "ready", label: "Ready", empty: "No Ready alerts yet." },
  { value: "watching", label: "Watching", empty: "Nothing is being watched right now." },
  { value: "expired", label: "Expired", empty: "No expired alerts." },
  { value: "skipped", label: "Skipped", empty: "You haven't skipped any alerts." },
];

export function AlertsBrowser({
  initial,
  initialStatus,
  pair,
  now,
}: {
  initial: AlertPage;
  initialStatus: StatusFilter;
  /** Optional ?pair= filter, kept for every request. */
  pair?: Pair;
  now: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [showTest, setShowTest] = useState(false);
  const [items, setItems] = useState<AlertListItem[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, startLoading] = useTransition();
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const nowDate = new Date(now);

  const reload = useCallback((next: { status: StatusFilter; showTest: boolean }) => {
    const id = ++request.current;
    setError(null);
    startLoading(async () => {
      try {
        const page = await loadAlerts({ status: next.status, includeTest: next.showTest, pair, cursor: null });
        if (id !== request.current) return; // a newer filter won
        setItems(page.items);
        setCursor(page.nextCursor);
      } catch {
        if (id === request.current) setError("Could not load alerts. Pull to refresh or try again.");
      }
    });
  }, [pair]);

  // The server rendered without test signals; switch them on if remembered.
  useEffect(() => {
    if (readShowTest()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowTest(true);
      reload({ status: initialStatus, showTest: true });
    }
  }, [initialStatus, reload]);

  function pickStatus(next: StatusFilter) {
    if (next === status) return;
    setStatus(next);
    const query = new URLSearchParams({ ...(next !== "all" && { status: next }), ...(pair && { pair }) }).toString();
    router.replace(query ? `/alerts?${query}` : "/alerts", { scroll: false });
    reload({ status: next, showTest });
  }

  function toggleTest(next: boolean) {
    setShowTest(next);
    saveShowTest(next);
    reload({ status, showTest: next });
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await loadAlerts({ status, includeTest: showTest, pair, cursor });
      setItems((prev) => [...prev, ...page.items.filter((i) => !prev.some((p) => p.id === i.id))]);
      setCursor(page.nextCursor);
    } catch {
      setError("Could not load more alerts. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  const chip = CHIPS.find((c) => c.value === status) ?? CHIPS[0];
  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter alerts">
        {CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={c.value === status}
            onClick={() => pickStatus(c.value)}
            className={cn(
              "h-9 rounded-[18px] border px-3.5 text-[13px] font-semibold",
              c.value === status ? "border-accent bg-accent text-on-accent" : "border-input bg-surface text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-default bg-surface px-3.5 py-2.5">
        <div>
          <p className="text-sm">Show test signals</p>
          <p className="text-xs text-muted">Silent paper signals from Test strategies</p>
        </div>
        <ToggleSwitch checked={showTest} onChange={toggleTest} label="Show test signals" />
      </div>

      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      {loading ? (
        <div aria-busy="true" aria-label="Loading alerts">
          <AlertCardsSkeleton cards={3} />
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-muted">{chip?.empty}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((a) => (
            <AlertCard key={a.id} alert={a} now={nowDate} />
          ))}
        </div>
      )}

      {!loading && cursor && (
        <PendingButton
          type="button"
          pending={loadingMore}
          pendingLabel="Loading…"
          onClick={loadMore}
          className="h-[52px] w-full rounded-xl border border-input font-semibold"
        >
          Load more
        </PendingButton>
      )}
    </>
  );
}
