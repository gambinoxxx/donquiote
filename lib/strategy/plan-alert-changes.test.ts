import { describe, expect, it } from "vitest";
import {
  applyAlertChanges,
  canMove,
  planAlertChanges,
  type AlertState,
} from "./apply-events";
import type { SetupEvent } from "./types";

const KEY = "EUR_USD:SELL:2026-11-03T23:30:00.000Z";
const STEP = "2026-11-04T00:00:00.000Z";

const sweep: SetupEvent = {
  type: "SWEEP",
  pair: "EUR_USD",
  dedupeKey: KEY,
  direction: "SELL",
  sweepType: "PDH",
  sweepLevel: 1.107,
  sweepExtreme: 1.1078,
  sweepTime: "2026-11-03T23:30:00.000Z",
  bosLevel: 1.1015,
  expiresAt: "2026-11-04T01:45:00.000Z",
};
const ticket = {
  entry: 1.101,
  stop: 1.1081,
  target: 1.0797,
  stopPips: 71,
  targetPips: 213,
  riskPct: 0.5,
  riskUsd: 50,
  lotSize: 0.07,
};
const watching: AlertState = { dedupeKey: KEY, status: "WATCHING", sweepExtreme: 1.1078 };
const plan = (existing: AlertState[], events: SetupEvent[]) =>
  planAlertChanges({ pair: "EUR_USD", existing, events, stepTime: STEP });

describe("planAlertChanges", () => {
  it("SWEEP creates a WATCHING alert with the sweep fields", () => {
    expect(plan([], [sweep])).toEqual([
      {
        kind: "create",
        alert: {
          dedupeKey: KEY,
          pair: "EUR_USD",
          direction: "SELL",
          sweepType: "PDH",
          sweepLevel: 1.107,
          sweepExtreme: 1.1078,
          sweepTime: "2026-11-03T23:30:00.000Z",
          bosLevel: 1.1015,
          expiresAt: "2026-11-04T01:45:00.000Z",
        },
      },
    ]);
  });

  it("SWEEP for an existing key is a no-op (idempotent create)", () => {
    expect(plan([watching], [sweep])).toEqual([]);
    expect(plan([{ ...watching, status: "EXPIRED" }], [sweep])).toEqual([]);
  });

  it("EXTEND updates the extreme while WATCHING, and is a no-op otherwise", () => {
    const extend: SetupEvent = { type: "EXTEND", dedupeKey: KEY, sweepExtreme: 1.109 };
    expect(plan([watching], [extend])).toEqual([
      { kind: "update", dedupeKey: KEY, fromStatus: "WATCHING", data: { sweepExtreme: 1.109 } },
    ]);
    expect(plan([{ ...watching, sweepExtreme: 1.109 }], [extend])).toEqual([]);
    expect(plan([{ ...watching, status: "READY" }], [extend])).toEqual([]);
  });

  it("CONFIRM moves WATCHING → READY with the ticket and readyAt = confirm candle close", () => {
    const confirm: SetupEvent = { type: "CONFIRM", dedupeKey: KEY, confirmTime: "2026-11-03T23:45:00.000Z", ticket };
    expect(plan([watching], [confirm])).toEqual([
      {
        kind: "update",
        dedupeKey: KEY,
        fromStatus: "WATCHING",
        data: { status: "READY", ...ticket, readyAt: "2026-11-04T00:00:00.000Z" },
      },
    ]);
  });

  it("EXPIRE moves WATCHING → EXPIRED with expiredAt", () => {
    expect(plan([watching], [{ type: "EXPIRE", dedupeKey: KEY, time: "2026-11-04T01:45:00.000Z" }])).toEqual([
      {
        kind: "update",
        dedupeKey: KEY,
        fromStatus: "WATCHING",
        data: { status: "EXPIRED", expiredAt: "2026-11-04T01:45:00.000Z" },
      },
    ]);
  });

  it("SKIP_INVALID moves WATCHING → EXPIRED with the reason as statusNote", () => {
    expect(plan([watching], [{ type: "SKIP_INVALID", dedupeKey: KEY, reason: "Lot size below 0.01" }])).toEqual([
      {
        kind: "update",
        dedupeKey: KEY,
        fromStatus: "WATCHING",
        data: { status: "EXPIRED", expiredAt: STEP, statusNote: "Lot size below 0.01" },
      },
    ]);
  });

  it("status only moves forward", () => {
    const confirm: SetupEvent = { type: "CONFIRM", dedupeKey: KEY, confirmTime: "2026-11-03T23:45:00.000Z", ticket };
    const expire: SetupEvent = { type: "EXPIRE", dedupeKey: KEY, time: "t" };
    for (const status of ["READY", "EXPIRED", "TAKEN", "SKIPPED"] as const) {
      expect(plan([{ ...watching, status }], [confirm, expire])).toEqual([]);
    }
    expect(canMove("WATCHING", "READY")).toBe(true);
    expect(canMove("READY", "WATCHING")).toBe(false);
    expect(canMove("EXPIRED", "READY")).toBe(false);
    expect(canMove("READY", "TAKEN")).toBe(true);
  });

  it("handles a whole sequence in one batch (sweep, extend, confirm)", () => {
    const events: SetupEvent[] = [
      sweep,
      { type: "EXTEND", dedupeKey: KEY, sweepExtreme: 1.109 },
      { type: "CONFIRM", dedupeKey: KEY, confirmTime: "2026-11-03T23:45:00.000Z", ticket },
    ];
    expect(plan([], events).map((c) => c.kind)).toEqual(["create", "update", "update"]);
  });

  it("is idempotent: applying the same events twice changes nothing the second time", () => {
    const events: SetupEvent[] = [
      sweep,
      { type: "EXTEND", dedupeKey: KEY, sweepExtreme: 1.109 },
      { type: "CONFIRM", dedupeKey: KEY, confirmTime: "2026-11-03T23:45:00.000Z", ticket },
    ];
    const first = plan([], events);
    const after = applyAlertChanges([], first);
    expect(after).toEqual([{ dedupeKey: KEY, status: "READY", sweepExtreme: 1.109 }]);
    expect(plan(after, events)).toEqual([]);
    expect(applyAlertChanges(after, first)).toEqual(after);
  });

  it("ignores events for unknown alerts", () => {
    expect(plan([], [{ type: "EXPIRE", dedupeKey: "nope", time: "t" }])).toEqual([]);
  });
});
