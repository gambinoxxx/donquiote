// DG's decision on a Ready alert: Skip, or "I took this trade" (which also
// opens a journal entry with the alert's ticket; DG logs the result later).
// Status only moves forward (architecture invariant 7): READY → SKIPPED or
// TAKEN, guarded in the database write itself. Paper trades are not
// affected: they follow every Ready alert whether DG took it or not.
import type { ActionResult } from "./types";

export type Decision = "SKIPPED" | "TAKEN";

/** The slice of the Prisma client this needs (easy to fake in tests). */
interface AlertForDecision {
  status: string;
  pair: string;
  direction: string;
  strategyId: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  lotSize: number | null;
  riskUsd: number | null;
}

const ALERT_FIELDS = {
  status: true,
  pair: true,
  direction: true,
  strategyId: true,
  entry: true,
  stop: true,
  target: true,
  lotSize: true,
  riskUsd: true,
} as const;

export interface DecideDb {
  alert: {
    findUnique(args: { where: { id: string }; select: typeof ALERT_FIELDS }): Promise<AlertForDecision | null>;
  };
  $transaction<T>(fn: (tx: DecideTx) => Promise<T>): Promise<T>;
}

export interface DecideTx {
  alert: {
    updateMany(args: { where: { id: string; status: "READY" }; data: { status: Decision; decidedAt: Date } }): Promise<{ count: number }>;
  };
  journalEntry: {
    create(args: { data: JournalCreate }): Promise<unknown>;
  };
}

export interface JournalCreate {
  alertId: string;
  strategyId: string;
  pair: never;
  direction: never;
  entry: number;
  stop: number;
  target: number;
  lots: number;
  riskUsd: number;
  openedAt: Date;
  status: "OPEN";
  createdBy: string;
}

const STATUS_TEXT: Record<string, string> = {
  WATCHING: "still watching: it can be marked once it is Ready",
  EXPIRED: "expired",
  TAKEN: "already marked as taken",
  SKIPPED: "already skipped",
};

export async function decideAlert(db: DecideDb, id: string, decision: Decision, now: Date, email: string): Promise<ActionResult> {
  const alert = await db.alert.findUnique({ where: { id }, select: ALERT_FIELDS });
  if (!alert) return { ok: false, error: "Alert not found." };
  const { entry, stop, target, lotSize, riskUsd } = alert;
  if (decision === "TAKEN" && (entry === null || stop === null || target === null || lotSize === null || riskUsd === null)) {
    return { ok: false, error: "This alert has no trade ticket to log." };
  }
  const done = await db.$transaction(async (tx) => {
    // Guarded: only a READY alert changes, so status never moves backwards.
    const { count } = await tx.alert.updateMany({
      where: { id, status: "READY" },
      data: { status: decision, decidedAt: now },
    });
    if (count !== 1) return false;
    if (decision === "TAKEN") {
      await tx.journalEntry.create({
        data: {
          alertId: id,
          strategyId: alert.strategyId,
          pair: alert.pair as never,
          direction: alert.direction as never,
          entry: entry as number,
          stop: stop as number,
          target: target as number,
          lots: lotSize as number,
          riskUsd: riskUsd as number,
          openedAt: now,
          status: "OPEN",
          createdBy: email,
        },
      });
    }
    return true;
  });
  if (done) return { ok: true };
  return { ok: false, error: `This alert is ${STATUS_TEXT[alert.status] ?? alert.status.toLowerCase()}.` };
}
