import { describe, expect, it } from "vitest";
import { planNotifications, type ReadyAlert, type RecentGroup } from "./plan";

const NOW = new Date("2026-11-04T10:00:10.000Z");
const READY = "2026-11-04T10:00:00.000Z";

const alert = (over: Partial<ReadyAlert> = {}): ReadyAlert => ({
  id: "a1",
  strategyId: "dg-v1",
  pair: "EUR_USD",
  direction: "SELL",
  readyAt: READY,
  modeAtReady: "LIVE",
  ...over,
});
const group = (over: Partial<RecentGroup> = {}): RecentGroup => ({
  id: "g1",
  pair: "EUR_USD",
  direction: "SELL",
  createdAt: "2026-11-04T09:45:10.000Z",
  strategyIds: ["dg-v1"],
  ...over,
});
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("planNotifications", () => {
  it("a LIVE alert creates a new group and is sent", () => {
    expect(planNotifications({ alerts: [alert()], groups: [], now: NOW })).toEqual([
      {
        kind: "send",
        alertId: "a1",
        group: { ref: "new:a1", pair: "EUR_USD", direction: "SELL", firstAlertId: "a1", strategyId: "dg-v1" },
      },
    ]);
  });

  it("TEST and OFF strategies never notify (mode when READY)", () => {
    const actions = planNotifications({
      alerts: [alert({ modeAtReady: "TEST" }), alert({ id: "a2", modeAtReady: "OFF" })],
      groups: [],
      now: NOW,
    });
    expect(actions).toEqual([
      { kind: "skip", alertId: "a1", reason: "not-live" },
      { kind: "skip", alertId: "a2", reason: "not-live" },
    ]);
  });

  it("a second LIVE strategy on the same pair and direction within 30 minutes merges into the group", () => {
    const actions = planNotifications({
      alerts: [alert({ id: "a2", strategyId: "dg-v2-candidate" })],
      groups: [group({ createdAt: minutesAgo(29) })],
      now: NOW,
    });
    expect(actions).toEqual([{ kind: "merge", alertId: "a2", strategyId: "dg-v2-candidate", group: { id: "g1" } }]);
  });

  it("two LIVE alerts in the same cycle: the first sends, the second merges into it", () => {
    const actions = planNotifications({
      alerts: [
        alert({ id: "b", strategyId: "pro-v1-swing", readyAt: READY }),
        alert({ id: "a", strategyId: "dg-v1", readyAt: "2026-11-04T09:45:00.000Z" }),
      ],
      groups: [],
      now: NOW,
    });
    expect(actions.map((a) => a.kind)).toEqual(["send", "merge"]);
    expect(actions[0]).toMatchObject({ alertId: "a" }); // earlier READY first
    expect(actions[1]).toEqual({ kind: "merge", alertId: "b", strategyId: "pro-v1-swing", group: { ref: "new:a" } });
  });

  it("a group created 31 minutes ago is closed: a new group is created", () => {
    const actions = planNotifications({ alerts: [alert()], groups: [group({ createdAt: minutesAgo(31) })], now: NOW });
    expect(actions[0]?.kind).toBe("send");
  });

  it("exactly 30 minutes ago still merges", () => {
    const actions = planNotifications({ alerts: [alert()], groups: [group({ createdAt: minutesAgo(30) })], now: NOW });
    expect(actions[0]?.kind).toBe("merge");
  });

  it("the opposite direction (or another pair) is never merged", () => {
    const actions = planNotifications({
      alerts: [alert({ direction: "BUY" }), alert({ id: "a2", pair: "GBP_USD" })],
      groups: [group()],
      now: NOW,
    });
    expect(actions.map((a) => a.kind)).toEqual(["send", "send"]);
  });

  it("an alert READY more than 20 minutes ago is STALE and not sent (and opens no group)", () => {
    const actions = planNotifications({
      alerts: [alert({ readyAt: minutesAgo(21) }), alert({ id: "a2", readyAt: minutesAgo(1) })],
      groups: [],
      now: NOW,
    });
    expect(actions[0]).toEqual({ kind: "stale", alertId: "a1", ageMs: 21 * 60_000 });
    expect(actions[1]?.kind).toBe("send"); // not merged into the stale one
  });

  it("20 minutes exactly is still sent", () => {
    expect(planNotifications({ alerts: [alert({ readyAt: minutesAgo(20) })], groups: [], now: NOW })[0]?.kind).toBe("send");
  });

  it("merges into the newest matching group", () => {
    const actions = planNotifications({
      alerts: [alert()],
      groups: [group({ id: "old", createdAt: minutesAgo(25) }), group({ id: "new", createdAt: minutesAgo(5) })],
      now: NOW,
    });
    expect(actions[0]).toMatchObject({ kind: "merge", group: { id: "new" } });
  });
});
