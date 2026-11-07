// Pure: decides what to do with alerts that just became READY.
// - only LIVE strategies notify (the mode when the alert became READY)
// - READY more than 20 minutes ago → STALE, never sent (an old signal is
//   worse than none, e.g. catch-up after downtime)
// - a group for the same pair and direction created in the last 30 minutes
//   → the alert joins it (MERGED), no new push or email
// - otherwise → a new group is created and sent
import type { Direction, Pair } from "@/lib/types";
import type { StrategyMode } from "@/lib/strategy/modes";

/** Alerts on the same pair + direction within this window share one notification. */
export const MERGE_WINDOW_MS = 30 * 60_000;
/** An alert that became READY longer ago than this is not sent. */
export const STALE_AFTER_MS = 20 * 60_000;

export interface ReadyAlert {
  id: string;
  strategyId: string;
  pair: Pair;
  direction: Direction;
  /** ISO, UTC: when the alert became READY (close of the confirming candle). */
  readyAt: string;
  /** The strategy's mode when the alert became READY. */
  modeAtReady: StrategyMode;
}

export interface RecentGroup {
  id: string;
  pair: Pair;
  direction: Direction;
  /** ISO, UTC. */
  createdAt: string;
  strategyIds: readonly string[];
}

/** A group created by this plan: referenced by `ref` until the database gives it an id. */
export interface NewGroup {
  ref: string;
  pair: Pair;
  direction: Direction;
  firstAlertId: string;
  strategyId: string;
}

export type NotifyAction =
  | { kind: "skip"; alertId: string; reason: "not-live" }
  | { kind: "stale"; alertId: string; ageMs: number }
  | { kind: "send"; alertId: string; group: NewGroup }
  | {
      kind: "merge";
      alertId: string;
      strategyId: string;
      /** An existing group's id, or the `ref` of a group created earlier in this plan. */
      group: { id: string } | { ref: string };
    };

export function planNotifications(args: {
  alerts: readonly ReadyAlert[];
  groups: readonly RecentGroup[];
  now: Date;
}): NotifyAction[] {
  const nowMs = args.now.getTime();
  const nowIso = args.now.toISOString();
  type Open = { pair: Pair; direction: Direction; createdAt: string; target: { id: string } | { ref: string } };
  const open: Open[] = args.groups
    .filter((g) => Date.parse(g.createdAt) >= nowMs - MERGE_WINDOW_MS)
    .map((g) => ({ pair: g.pair, direction: g.direction, createdAt: g.createdAt, target: { id: g.id } }));

  const ordered = [...args.alerts].sort(
    (a, b) => a.readyAt.localeCompare(b.readyAt) || a.id.localeCompare(b.id),
  );
  const actions: NotifyAction[] = [];
  for (const alert of ordered) {
    if (alert.modeAtReady !== "LIVE") {
      actions.push({ kind: "skip", alertId: alert.id, reason: "not-live" });
      continue;
    }
    const ageMs = nowMs - Date.parse(alert.readyAt);
    if (ageMs > STALE_AFTER_MS) {
      actions.push({ kind: "stale", alertId: alert.id, ageMs });
      continue;
    }
    // Newest matching group first.
    const group = open
      .filter((g) => g.pair === alert.pair && g.direction === alert.direction)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (group) {
      actions.push({ kind: "merge", alertId: alert.id, strategyId: alert.strategyId, group: group.target });
      continue;
    }
    const ref = `new:${alert.id}`;
    actions.push({
      kind: "send",
      alertId: alert.id,
      group: { ref, pair: alert.pair, direction: alert.direction, firstAlertId: alert.id, strategyId: alert.strategyId },
    });
    open.push({ pair: alert.pair, direction: alert.direction, createdAt: nowIso, target: { ref } });
  }
  return actions;
}
