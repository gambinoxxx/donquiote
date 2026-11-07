// DG's decision on a Ready alert: Skip, or "I took this trade" (which also
// starts a journal entry, result pending; Unit 14 logs the result).
// Status only moves forward (architecture invariant 7): READY → SKIPPED or
// TAKEN, guarded in the database write itself. Paper trades are not
// affected: they follow every Ready alert whether DG took it or not.
import type { ActionResult } from "./types";

export type Decision = "SKIPPED" | "TAKEN";

/** The slice of the Prisma client this needs (easy to fake in tests). */
export interface DecideDb {
  alert: {
    findUnique(args: { where: { id: string }; select: { status: true; pair: true; direction: true } }): Promise<{
      status: string;
      pair: string;
      direction: string;
    } | null>;
  };
  $transaction<T>(fn: (tx: DecideTx) => Promise<T>): Promise<T>;
}

export interface DecideTx {
  alert: {
    updateMany(args: { where: { id: string; status: "READY" }; data: { status: Decision; decidedAt: Date } }): Promise<{ count: number }>;
  };
  journalEntry: {
    create(args: { data: { alertId: string; pair: never; direction: never; takenAt: Date } }): Promise<unknown>;
  };
}

const STATUS_TEXT: Record<string, string> = {
  WATCHING: "still watching: it can be marked once it is Ready",
  EXPIRED: "expired",
  TAKEN: "already marked as taken",
  SKIPPED: "already skipped",
};

export async function decideAlert(db: DecideDb, id: string, decision: Decision, now: Date): Promise<ActionResult> {
  const alert = await db.alert.findUnique({ where: { id }, select: { status: true, pair: true, direction: true } });
  if (!alert) return { ok: false, error: "Alert not found." };
  const done = await db.$transaction(async (tx) => {
    // Guarded: only a READY alert changes, so status never moves backwards.
    const { count } = await tx.alert.updateMany({
      where: { id, status: "READY" },
      data: { status: decision, decidedAt: now },
    });
    if (count !== 1) return false;
    if (decision === "TAKEN") {
      await tx.journalEntry.create({
        data: { alertId: id, pair: alert.pair as never, direction: alert.direction as never, takenAt: now },
      });
    }
    return true;
  });
  if (done) return { ok: true };
  return { ok: false, error: `This alert is ${STATUS_TEXT[alert.status] ?? alert.status.toLowerCase()}.` };
}
