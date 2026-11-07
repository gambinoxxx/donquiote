// Pure helpers for the paper trade commands (paper:backfill, paper:report).
// No I/O: the scripts load rows and pass them in.
import type { AlertStatus } from "@/lib/types";
import type { PaperStatus } from "@/lib/paper/resolve";
import { isPaperTicket } from "@/lib/strategy/apply-events";


/** Alert statuses that went through READY, so they have a ticket. */
const PASSED_READY: readonly AlertStatus[] = ["READY", "TAKEN", "SKIPPED"];

/** The alert fields the backfill looks at. */
export interface BackfillAlert {
  id: string;
  status: AlertStatus;
  paperStatus: PaperStatus | null;
  /** ISO, UTC. */
  readyAt: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  stopPips: number | null;
  targetPips: number | null;
  lotSize: number | null;
  riskPct: number | null;
  riskUsd: number | null;
}

export interface BackfillOpen {
  alertId: string;
  /** = readyAt: the close time of the confirming candle. */
  paperOpenedAt: string;
}

/**
 * Alerts that should have a paper trade but don't: they passed READY, have
 * a complete, valid ticket and readyAt, and no paperStatus yet. Running it
 * again after the opens are saved returns nothing.
 */
export function planPaperBackfill(alerts: readonly BackfillAlert[]): BackfillOpen[] {
  return alerts.flatMap((a) => {
    if (!PASSED_READY.includes(a.status) || a.paperStatus !== null || a.readyAt === null) return [];
    const { entry, stop, target, stopPips, targetPips, lotSize, riskPct, riskUsd } = a;
    if (
      entry === null ||
      stop === null ||
      target === null ||
      stopPips === null ||
      targetPips === null ||
      lotSize === null ||
      riskPct === null ||
      riskUsd === null
    ) {
      return [];
    }
    const ticket = { entry, stop, target, stopPips, targetPips, lotSize, riskPct, riskUsd };
    return isPaperTicket(ticket) ? [{ alertId: a.id, paperOpenedAt: a.readyAt }] : [];
  });
}

// Totals moved to lib/paper/summary.ts so the dashboard can use them too.
export { summarizePaper, type PaperRow, type PaperSummary } from "@/lib/paper/summary";
