import type { AlertStatus, Direction, EntryType, Pair, TradeTicket } from "@/lib/types";
import { MIN_LOT_SIZE } from "./shared/ticket";
import type { OpenSetup, RecentAlert, SetupEvent, SweepType } from "./types";

/**
 * Applies events to the list of WATCHING setups (pure): SWEEP adds,
 * EXTEND moves the extreme, CONFIRM / EXPIRE / SKIP_INVALID remove.
 * Used by replays (tests, backtest) to feed the next evaluate call.
 */
export function applyEvents(
  openSetups: readonly OpenSetup[],
  events: readonly SetupEvent[],
): OpenSetup[] {
  let setups = [...openSetups];
  for (const event of events) {
    switch (event.type) {
      case "SWEEP":
        setups.push({
          dedupeKey: event.dedupeKey,
          direction: event.direction,
          sweepType: event.sweepType,
          sweepLevel: event.sweepLevel,
          sweepExtreme: event.sweepExtreme,
          sweepTime: event.sweepTime,
          bosLevel: event.bosLevel,
          expiresAt: event.expiresAt,
        });
        break;
      case "EXTEND":
        setups = setups.map((s) =>
          s.dedupeKey === event.dedupeKey ? { ...s, sweepExtreme: event.sweepExtreme } : s,
        );
        break;
      case "CONFIRM":
      case "EXPIRE":
      case "SKIP_INVALID":
        setups = setups.filter((s) => s.dedupeKey !== event.dedupeKey);
        break;
    }
  }
  return setups;
}

const M15_CANDLE_MS = 15 * 60_000;

/**
 * Applies events to the strategy's recent alerts (pure): SWEEP adds a
 * WATCHING alert (once per key), CONFIRM makes it READY with its ticket,
 * EXPIRE / SKIP_INVALID make it EXPIRED. Same transitions as
 * planAlertChanges, so the worker (which reloads from the database) and
 * the backtester (which only keeps memory) see the same alerts.
 */
export function applyEventsToRecent(
  recent: readonly RecentAlert[],
  events: readonly SetupEvent[],
): RecentAlert[] {
  const alerts = recent.map((a) => ({ ...a }));
  const find = (key: string) => alerts.find((a) => a.dedupeKey === key);
  for (const event of events) {
    switch (event.type) {
      case "SWEEP":
        if (!find(event.dedupeKey)) {
          alerts.push({
            dedupeKey: event.dedupeKey,
            direction: event.direction,
            status: "WATCHING",
            sweepType: event.sweepType,
            sweepLevel: event.sweepLevel,
            sweepTime: event.sweepTime,
          });
        }
        break;
      case "CONFIRM": {
        const alert = find(event.dedupeKey);
        if (alert?.status !== "WATCHING") break;
        Object.assign(alert, {
          status: "READY",
          readyAt: new Date(Date.parse(event.confirmTime) + M15_CANDLE_MS).toISOString(),
          entry: event.ticket.entry,
          stop: event.ticket.stop,
          target: event.ticket.target,
          entryType: event.entryType ?? "MARKET",
          ...(event.entryValidUntil !== undefined && { entryValidUntil: event.entryValidUntil }),
        });
        break;
      }
      case "EXPIRE":
      case "SKIP_INVALID": {
        const alert = find(event.dedupeKey);
        if (alert?.status === "WATCHING") alert.status = "EXPIRED";
        break;
      }
      case "EXTEND":
        break;
    }
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// Events → alert changes (used by the live worker; pure, no I/O)
// ---------------------------------------------------------------------------


/** What the worker knows about an existing alert of this strategy. */
export interface AlertState {
  dedupeKey: string;
  status: AlertStatus;
  sweepExtreme: number;
}

export interface NewAlert {
  dedupeKey: string;
  pair: Pair;
  direction: Direction;
  sweepType: SweepType;
  sweepLevel: number;
  sweepExtreme: number;
  /** ISO, UTC. */
  sweepTime: string;
  bosLevel: number;
  /** ISO, UTC. */
  expiresAt: string;
}

export interface AlertUpdate {
  status?: AlertStatus;
  statusNote?: string;
  sweepExtreme?: number;
  entry?: number;
  stop?: number;
  target?: number;
  stopPips?: number;
  targetPips?: number;
  lotSize?: number;
  riskPct?: number;
  riskUsd?: number;
  /** ISO, UTC. */
  readyAt?: string;
  /** ISO, UTC. */
  expiredAt?: string;
  /** Set with READY; MARKET unless the strategy asked for a limit entry. */
  entryType?: EntryType;
  /** LIMIT only (ISO, UTC). */
  entryValidUntil?: string;
  /** Set to OPEN together with READY when the ticket is valid (Unit 8). */
  paperStatus?: "OPEN";
  /** ISO, UTC: close time of the confirming candle. */
  paperOpenedAt?: string;
}

export type AlertChange =
  | { kind: "create"; alert: NewAlert }
  | {
      kind: "update";
      dedupeKey: string;
      /** The update only applies if the alert is still in this status. */
      fromStatus: AlertStatus;
      data: AlertUpdate;
    };

/** Allowed forward moves (architecture invariant 7). */
const FORWARD: Record<AlertStatus, readonly AlertStatus[]> = {
  WATCHING: ["READY", "EXPIRED"],
  READY: ["TAKEN", "SKIPPED"],
  EXPIRED: [],
  TAKEN: [],
  SKIPPED: [],
};

export function canMove(from: AlertStatus, to: AlertStatus): boolean {
  return FORWARD[from].includes(to);
}

const M15_MS = 15 * 60_000;

/**
 * A ticket a paper trade can be opened from: a tradable lot size (≥ 0.01)
 * and a non-zero stop distance. dg-v1 already turns anything else into
 * SKIP_INVALID; this guards every strategy the same way.
 */
export function isPaperTicket(ticket: TradeTicket): boolean {
  return (
    Number.isFinite(ticket.entry) &&
    Number.isFinite(ticket.stop) &&
    Number.isFinite(ticket.target) &&
    ticket.lotSize >= MIN_LOT_SIZE &&
    ticket.entry !== ticket.stop
  );
}

/**
 * Plans the database changes for one candle's events:
 * - SWEEP → create a WATCHING alert (no-op if the key already exists)
 * - EXTEND → update sweepExtreme while WATCHING
 * - CONFIRM → WATCHING → READY with the ticket and readyAt (confirm candle
 *   close); with a valid ticket the same update opens the paper trade
 *   (paperStatus OPEN, paperOpenedAt = readyAt)
 * - EXPIRE → WATCHING → EXPIRED with expiredAt
 * - SKIP_INVALID → WATCHING → EXPIRED with expiredAt = this candle's close
 *   and statusNote = the reason
 * Status only moves forward; anything else is a no-op, so applying the same
 * events twice changes nothing.
 */
export function planAlertChanges(args: {
  pair: Pair;
  existing: readonly AlertState[];
  events: readonly SetupEvent[];
  /** ISO close time of the candle that produced the events. */
  stepTime: string;
}): AlertChange[] {
  const states = new Map(args.existing.map((a) => [a.dedupeKey, { ...a }]));
  const changes: AlertChange[] = [];

  const update = (dedupeKey: string, to: AlertStatus | null, data: AlertUpdate) => {
    const state = states.get(dedupeKey);
    if (!state) return;
    if (to === null) {
      if (state.status !== "WATCHING") return;
    } else if (!canMove(state.status, to)) {
      return;
    }
    changes.push({ kind: "update", dedupeKey, fromStatus: state.status, data });
    if (to) state.status = to;
    if (data.sweepExtreme !== undefined) state.sweepExtreme = data.sweepExtreme;
  };

  for (const event of args.events) {
    switch (event.type) {
      case "SWEEP": {
        if (states.has(event.dedupeKey)) break;
        const alert: NewAlert = {
          dedupeKey: event.dedupeKey,
          pair: args.pair,
          direction: event.direction,
          sweepType: event.sweepType,
          sweepLevel: event.sweepLevel,
          sweepExtreme: event.sweepExtreme,
          sweepTime: event.sweepTime,
          bosLevel: event.bosLevel,
          expiresAt: event.expiresAt,
        };
        changes.push({ kind: "create", alert });
        states.set(event.dedupeKey, {
          dedupeKey: event.dedupeKey,
          status: "WATCHING",
          sweepExtreme: event.sweepExtreme,
        });
        break;
      }
      case "EXTEND": {
        const state = states.get(event.dedupeKey);
        if (!state || state.sweepExtreme === event.sweepExtreme) break;
        update(event.dedupeKey, null, { sweepExtreme: event.sweepExtreme });
        break;
      }
      case "CONFIRM": {
        const t = event.ticket;
        const readyAt = new Date(Date.parse(event.confirmTime) + M15_MS).toISOString();
        update(event.dedupeKey, "READY", {
          status: "READY",
          entry: t.entry,
          stop: t.stop,
          target: t.target,
          stopPips: t.stopPips,
          targetPips: t.targetPips,
          lotSize: t.lotSize,
          riskPct: t.riskPct,
          riskUsd: t.riskUsd,
          readyAt,
          entryType: event.entryType ?? "MARKET",
          ...(event.entryValidUntil !== undefined && { entryValidUntil: event.entryValidUntil }),
          ...(isPaperTicket(t) && { paperStatus: "OPEN" as const, paperOpenedAt: readyAt }),
        });
        break;
      }
      case "EXPIRE":
        update(event.dedupeKey, "EXPIRED", { status: "EXPIRED", expiredAt: event.time });
        break;
      case "SKIP_INVALID":
        update(event.dedupeKey, "EXPIRED", {
          status: "EXPIRED",
          expiredAt: args.stepTime,
          statusNote: event.reason,
        });
        break;
    }
  }
  return changes;
}

/** Applies planned changes to alert states (pure; for replays and tests). */
export function applyAlertChanges(
  existing: readonly AlertState[],
  changes: readonly AlertChange[],
): AlertState[] {
  const states = new Map(existing.map((a) => [a.dedupeKey, { ...a }]));
  for (const change of changes) {
    if (change.kind === "create") {
      if (!states.has(change.alert.dedupeKey)) {
        states.set(change.alert.dedupeKey, {
          dedupeKey: change.alert.dedupeKey,
          status: "WATCHING",
          sweepExtreme: change.alert.sweepExtreme,
        });
      }
      continue;
    }
    const state = states.get(change.dedupeKey);
    if (!state || state.status !== change.fromStatus) continue;
    if (change.data.status) state.status = change.data.status;
    if (change.data.sweepExtreme !== undefined) state.sweepExtreme = change.data.sweepExtreme;
  }
  return [...states.values()];
}
