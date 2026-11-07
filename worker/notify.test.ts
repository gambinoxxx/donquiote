// The notification outbox inside the worker cycle, with the in-memory store
// and fake push / email clients.
import { describe, expect, it, vi } from "vitest";
import type { Candle, Timeframe } from "@/lib/types";
import type { NotifyChannels } from "@/lib/notify/deliver";
import { SETTINGS } from "@/lib/strategy/__fixtures__/candles";
import type { SetupEvent, Strategy, StrategyInput } from "@/lib/strategy/types";
import { runCycle } from "./cycle";
import { notifyPending } from "./notify";
import { memoryPriceSource } from "./prices";
import { MemoryStore, type MemorySubscription } from "./store";

const M15 = 15 * 60_000;
const START = Date.parse("2026-11-04T08:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const m15 = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: iso(START + i * M15), open: 1.1, high: 1.1005, low: 1.0995, close: 1.1 }));
const CANDLES = m15(12);
const tf = (c: Candle[]): Record<Timeframe, Candle[]> => ({ D: [], H4: [], M15: c });
const closeOf = (i: number) => new Date(START + (i + 1) * M15 + 10_000); // 10 s after the close, like the scheduler

/** SWEEP on candle `at`, CONFIRM on the next one (READY at its close). */
function confirmer(id: string, at: number, direction: "BUY" | "SELL" = "SELL"): Strategy {
  const sweepTime = CANDLES[at]?.time as string;
  const confirmTime = CANDLES[at + 1]?.time as string;
  const key = `EUR_USD:${direction}:${sweepTime}`;
  return {
    id,
    name: id,
    description: "test",
    evaluate(input: StrategyInput): SetupEvent[] {
      const t = input.candles.M15.at(-1)?.time;
      if (t === sweepTime) {
        return [
          {
            type: "SWEEP",
            pair: "EUR_USD",
            dedupeKey: key,
            direction,
            sweepType: "PDH",
            sweepLevel: 1.1004,
            sweepExtreme: 1.1005,
            sweepTime,
            bosLevel: 1.0996,
            expiresAt: iso(START + 20 * M15),
          },
        ];
      }
      if (t === confirmTime) {
        return [
          {
            type: "CONFIRM",
            dedupeKey: key,
            confirmTime,
            ticket: { entry: 1.0995, stop: 1.1008, target: 1.0956, stopPips: 13, targetPips: 39, riskPct: 0.5, riskUsd: 50, lotSize: 0.38 },
          },
        ];
      }
      return [];
    },
  };
}

function fakeChannels(opts: { pushFails?: boolean | number; emailFails?: boolean } = {}) {
  const pushSend = vi.fn(async () => {
    if (opts.pushFails === true) throw new Error("push down");
    if (typeof opts.pushFails === "number") throw Object.assign(new Error("x"), { statusCode: opts.pushFails });
  });
  const emailSend = vi.fn(async () => {
    if (opts.emailFails) throw new Error("email down");
  });
  const channels: NotifyChannels = {
    appUrl: "http://localhost:3000",
    push: { client: { send: pushSend } },
    email: { client: { send: emailSend }, from: "alerts@example.com", recipients: ["dg@example.com", "g@example.com"] },
  };
  return { channels, pushSend, emailSend };
}

const SUB: MemorySubscription = { id: "sub1", endpoint: "https://push.example/1", p256dh: "p", auth: "a", failCount: 0, userEmail: "dg@example.com" };

function setup(modes: Array<{ strategyId: string; mode: "LIVE" | "TEST" | "OFF" }>, subs: MemorySubscription[] = [SUB]) {
  const store = new MemoryStore({ settings: SETTINGS, enabledPairs: ["EUR_USD"], strategyModes: modes, subscriptions: subs.map((s) => ({ ...s })) });
  for (const { strategyId } of modes) store.cursors.set(`EUR_USD|${strategyId}`, CANDLES[0]?.time as string);
  return store;
}

async function cycle(store: MemoryStore, strategies: Strategy[], candleIndex: number, channels?: NotifyChannels, logs: Record<string, unknown>[] = []) {
  return runCycle({
    store,
    prices: memoryPriceSource({ EUR_USD: tf(CANDLES.slice(0, candleIndex + 1)) }),
    now: closeOf(candleIndex),
    getStrategy: (id) => strategies.find((s) => s.id === id) as Strategy,
    logger: (l) => logs.push(l),
    ...(channels && { notify: channels }),
  });
}

describe("notifications in the worker cycle", () => {
  it("a LIVE strategy's READY alert sends one push and one email per address, then SENT", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }]);
    const { channels, pushSend, emailSend } = fakeChannels();
    const logs: Record<string, unknown>[] = [];
    const report = await cycle(store, [confirmer("dg-v1", 2)], 3, channels, logs);

    const [alert] = store.listAlerts();
    expect(alert).toMatchObject({ status: "READY", notifyState: "SENT" });
    expect(pushSend).toHaveBeenCalledTimes(1);
    expect(emailSend).toHaveBeenCalledTimes(2);
    expect(report.notify).toMatchObject({ sent: 1, merged: 0 });
    const [group] = store.groups.values();
    expect(group).toMatchObject({ pair: "EUR_USD", direction: "SELL", firstAlertId: alert?.id, strategyIds: ["dg-v1"] });
    expect(group?.counts).toEqual({ pushSent: 1, pushFailed: 0, emailSent: 2, emailFailed: 0 });
    expect(logs).toContainEqual(
      expect.objectContaining({ component: "notify", pair: "EUR_USD", direction: "SELL", strategies: "dg-v1", pushSent: 1, emailSent: 2, outcome: "sent" }),
    );
    const payload = JSON.parse((pushSend.mock.calls[0] as unknown as [unknown, string])[1]) as Record<string, string>;
    expect(payload).toMatchObject({ title: "EUR/USD SELL · Ready", url: `/alerts/${alert?.id}`, tag: group?.id });
    // Never logs endpoints or addresses.
    expect(JSON.stringify(logs)).not.toMatch(/push\.example|@example\.com/);
  });

  it("a TEST strategy's READY alert sends nothing (never enters the outbox)", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }, { strategyId: "fvg", mode: "TEST" }]);
    const { channels, pushSend, emailSend } = fakeChannels();
    await cycle(store, [confirmer("dg-v1", 9), confirmer("fvg", 2)], 3, channels);
    const [alert] = store.listAlerts("fvg");
    expect(alert?.status).toBe("READY");
    expect(alert?.notifyState).toBeUndefined(); // NONE in the database
    expect(pushSend).not.toHaveBeenCalled();
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("two LIVE strategies on the same pair and direction within 30 minutes notify once", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }, { strategyId: "pro", mode: "LIVE" }]);
    const { channels, pushSend, emailSend } = fakeChannels();
    await cycle(store, [confirmer("dg-v1", 2), confirmer("pro", 4)], 3, channels); // dg-v1 READY 09:00
    await cycle(store, [confirmer("dg-v1", 2), confirmer("pro", 4)], 5, channels); // pro READY 09:30
    expect(pushSend).toHaveBeenCalledTimes(1);
    expect(emailSend).toHaveBeenCalledTimes(2);
    expect(store.listAlerts("pro")[0]).toMatchObject({ notifyState: "MERGED" });
    const [group] = store.groups.values();
    expect(group?.strategyIds).toEqual(["dg-v1", "pro"]);
    expect(store.listAlerts("pro")[0]?.notifyGroupId).toBe(group?.id);
  });

  it("the opposite direction is not merged", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }, { strategyId: "pro", mode: "LIVE" }]);
    const { channels, pushSend } = fakeChannels();
    await cycle(store, [confirmer("dg-v1", 2, "SELL"), confirmer("pro", 2, "BUY")], 3, channels);
    expect(pushSend).toHaveBeenCalledTimes(2);
    expect(store.groups.size).toBe(2);
  });

  it("running the send step twice sends once", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }]);
    const { channels, pushSend } = fakeChannels();
    await cycle(store, [confirmer("dg-v1", 2)], 3); // commit only (no channels): PENDING
    expect(store.listAlerts()[0]?.notifyState).toBe("PENDING");
    const now = closeOf(3);
    const logger = () => {};
    const [a, b] = await Promise.all([
      notifyPending({ store, channels, now, logger }),
      notifyPending({ store, channels, now, logger }),
    ]);
    await notifyPending({ store, channels, now, logger });
    expect(a.sent + b.sent).toBe(1);
    expect(pushSend).toHaveBeenCalledTimes(1);
    expect(store.groups.size).toBe(1);
  });

  it("a PENDING alert left by a crash is sent on the next cycle", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }]);
    const { channels, pushSend } = fakeChannels();
    await cycle(store, [confirmer("dg-v1", 2)], 3); // READY + PENDING committed, then "crash" before sending
    expect(pushSend).not.toHaveBeenCalled();
    await cycle(store, [confirmer("dg-v1", 2)], 4, channels); // next cycle, 15 min later
    expect(pushSend).toHaveBeenCalledTimes(1);
    expect(store.listAlerts()[0]?.notifyState).toBe("SENT");
  });

  it("a PENDING alert more than 20 minutes old is marked STALE and not sent", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }]);
    const { channels, pushSend } = fakeChannels();
    await cycle(store, [confirmer("dg-v1", 2)], 3); // READY 09:00, not sent
    const logs: Record<string, unknown>[] = [];
    await cycle(store, [confirmer("dg-v1", 2)], 5, channels, logs); // 09:30:10 → 30 min old
    expect(pushSend).not.toHaveBeenCalled();
    expect(store.listAlerts()[0]?.notifyState).toBe("STALE");
    expect(logs).toContainEqual(expect.objectContaining({ component: "notify", outcome: "stale", ageMin: 30 }));
  });

  it("an alert claimed by a run that never finished is marked FAILED, never resent", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }]);
    const { channels, pushSend } = fakeChannels();
    await cycle(store, [confirmer("dg-v1", 2)], 3);
    const [alert] = store.listAlerts();
    await store.claimForSend(alert?.id as string, { pair: "EUR_USD", direction: "SELL", strategyId: "dg-v1", createdAt: iso(START) });
    await notifyPending({ store, channels, now: closeOf(3), logger: () => {} });
    expect(pushSend).not.toHaveBeenCalled();
    expect(store.listAlerts()[0]?.notifyState).toBe("FAILED");
  });

  it("push and email failures don't stop the cycle; the alert is FAILED when nothing got through", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }]);
    const { channels } = fakeChannels({ pushFails: true, emailFails: true });
    const report = await cycle(store, [confirmer("dg-v1", 2)], 3, channels);
    expect(report.status).toBe("ok");
    expect(store.listAlerts()[0]).toMatchObject({ status: "READY", notifyState: "FAILED", paperStatus: "OPEN" });
    expect([...store.groups.values()][0]?.counts).toEqual({ pushSent: 0, pushFailed: 1, emailSent: 0, emailFailed: 2 });
  });

  it("only email getting through still counts as SENT", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }]);
    const { channels } = fakeChannels({ pushFails: true });
    await cycle(store, [confirmer("dg-v1", 2)], 3, channels);
    expect(store.listAlerts()[0]?.notifyState).toBe("SENT");
  });

  it("a 410 deletes the subscription; other failures add up and the 5th deletes it", async () => {
    const gone = setup([{ strategyId: "dg-v1", mode: "LIVE" }]);
    await cycle(gone, [confirmer("dg-v1", 2)], 3, fakeChannels({ pushFails: 410 }).channels);
    expect(gone.subscriptions).toEqual([]);

    const flaky = setup([{ strategyId: "dg-v1", mode: "LIVE" }], [{ ...SUB, failCount: 3 }]);
    await cycle(flaky, [confirmer("dg-v1", 2)], 3, fakeChannels({ pushFails: 500 }).channels);
    expect(flaky.subscriptions[0]?.failCount).toBe(4);
    await flaky.applyPushOutcomes([{ id: "sub1", result: "failed", status: 500, error: "HTTP 500", deleteNow: true }], iso(START));
    expect(flaky.subscriptions).toEqual([]);

    const healthy = setup([{ strategyId: "dg-v1", mode: "LIVE" }], [{ ...SUB, failCount: 3 }]);
    await cycle(healthy, [confirmer("dg-v1", 2)], 3, fakeChannels().channels);
    expect(healthy.subscriptions[0]).toMatchObject({ failCount: 0, lastSuccessAt: expect.any(String) });
  });

  it("push turned off in Settings: email only", async () => {
    const store = setup([{ strategyId: "dg-v1", mode: "LIVE" }]);
    store.pushEnabled = false;
    const { channels, pushSend, emailSend } = fakeChannels();
    await cycle(store, [confirmer("dg-v1", 2)], 3, channels);
    expect(pushSend).not.toHaveBeenCalled();
    expect(emailSend).toHaveBeenCalledTimes(2);
  });
});
