// Unit 17 worker paths: per-strategy time exit, READY straight away
// (SWEEP + CONFIRM on one candle) and red news passed to strategies that use it.
import { describe, expect, it } from "vitest";
import type { Candle, Timeframe } from "@/lib/types";
import { NOTE_TIME_EXIT } from "@/lib/paper/resolve";
import { SETTINGS } from "@/lib/strategy/__fixtures__/candles";
import type { RedNewsEvent, SetupEvent, Strategy, StrategyInput } from "@/lib/strategy/types";
import { resolvePaperTrades, runCycle } from "./cycle";
import { memoryPriceSource } from "./prices";
import { MemoryStore, type MemoryAlert } from "./store";

const M15 = 15 * 60_000;
// Tue 10 Mar 2026, 08:00 UTC.
const START = Date.parse("2026-03-10T08:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** Quiet BUY-side candles from START that never reach 1.0980 or 1.1060. */
function quiet(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({ time: iso(START + i * M15), open: 1.1, high: 1.1005, low: 1.0995, close: 1.1002 }));
}

function trade(s: MemoryStore, strategyId: string): MemoryAlert {
  const openedAt = iso(START);
  return s.putAlert({
    strategyId,
    dedupeKey: `EUR_USD:BUY:${iso(START - M15)}:${strategyId}`,
    pair: "EUR_USD",
    direction: "BUY",
    status: "READY",
    sweepType: "ASH",
    sweepLevel: 1.099,
    sweepExtreme: 1.099,
    sweepTime: iso(START - M15),
    bosLevel: 1.099,
    expiresAt: openedAt,
    entry: 1.1,
    stop: 1.098,
    target: 1.103,
    stopPips: 20,
    targetPips: 30,
    lotSize: 0.25,
    riskPct: 0.5,
    riskUsd: 50,
    readyAt: openedAt,
    paperStatus: "OPEN",
    paperOpenedAt: openedAt,
  });
}

function store() {
  return new MemoryStore({ settings: SETTINGS, enabledPairs: ["EUR_USD"], strategyModes: [{ strategyId: "rec", mode: "LIVE" }] });
}

describe("paper time exit in the worker", () => {
  it("london-break trades close Unresolved at 16:00 UTC; others keep the 72 h limit", async () => {
    const s = store();
    await s.saveCandles("EUR_USD", "M15", quiet(40)); // 08:00 → 17:45
    const ldn = trade(s, "london-break");
    const other = trade(s, "gemini-fvg");
    const report = await resolvePaperTrades({ store: s, pair: "EUR_USD", timeoutCandles: 288, logger: () => {} });
    expect(report).toEqual({ open: 2, resolved: 1, failed: 0 });
    const [a, b] = [s.listAlerts().find((x) => x.id === ldn.id), s.listAlerts().find((x) => x.id === other.id)];
    expect(a).toMatchObject({
      paperStatus: "UNRESOLVED",
      paperClosedAt: "2026-03-10T16:00:00.000Z",
      paperExitPrice: 1.1002,
      paperResultR: 0.1,
      paperPnlUsd: 5,
      paperNote: NOTE_TIME_EXIT,
    });
    expect(b?.paperStatus).toBe("OPEN");
  });

  it("an injected lookup decides the exit hour (absent → unchanged resolver)", async () => {
    const s = store();
    await s.saveCandles("EUR_USD", "M15", quiet(40));
    trade(s, "x");
    await resolvePaperTrades({ store: s, pair: "EUR_USD", timeoutCandles: 288, logger: () => {}, exitAtUtcHour: () => undefined });
    expect(s.listAlerts()[0]?.paperStatus).toBe("OPEN");
    await resolvePaperTrades({ store: s, pair: "EUR_USD", timeoutCandles: 288, logger: () => {}, exitAtUtcHour: () => 9 });
    expect(s.listAlerts()[0]).toMatchObject({ paperStatus: "UNRESOLVED", paperClosedAt: "2026-03-10T09:00:00.000Z" });
  });
});

describe("READY straight away and red news input", () => {
  it("SWEEP + CONFIRM on one candle → one READY alert with an open paper trade; red news reaches the strategy", async () => {
    const m15 = quiet(4);
    const breakout = m15[2] as Candle;
    const key = `EUR_USD:BUY:${breakout.time}`;
    const seen: Array<readonly RedNewsEvent[] | undefined> = [];
    const strategy: Strategy = {
      id: "rec",
      name: "rec",
      description: "breakout",
      usesRedNews: true,
      evaluate(input: StrategyInput): SetupEvent[] {
        seen.push(input.redNews);
        if (input.candles.M15.at(-1)?.time !== breakout.time) return [];
        return [
          {
            type: "SWEEP",
            pair: "EUR_USD",
            dedupeKey: key,
            direction: "BUY",
            sweepType: "ASH",
            sweepLevel: 1.099,
            sweepExtreme: 1.0995,
            sweepTime: breakout.time,
            bosLevel: 1.099,
            expiresAt: iso(Date.parse(breakout.time) + M15),
          },
          {
            type: "CONFIRM",
            dedupeKey: key,
            confirmTime: breakout.time,
            ticket: { entry: 1.1002, stop: 1.0975, target: 1.1043, stopPips: 27, targetPips: 40.5, riskPct: 0.5, riskUsd: 50, lotSize: 0.18 },
          },
        ];
      },
    };
    const s = store();
    s.cursors.set("EUR_USD|rec", m15[1]?.time as string);
    s.redNews = [
      { currency: "USD", time: "2026-03-10T08:45:00.000Z" },
      { currency: "JPY", time: "2026-03-10T08:45:00.000Z" }, // other pair
      { currency: "EUR", time: "2026-03-11T08:45:00.000Z" }, // far away
    ];
    const tf: Record<Timeframe, Candle[]> = { D: [], H4: [], M15: m15 };
    const report = await runCycle({
      store: s,
      prices: memoryPriceSource({ EUR_USD: tf }),
      now: new Date(Date.parse(breakout.time) + M15 + 10_000),
      getStrategy: () => strategy,
      logger: () => {},
    });
    expect(report.status).toBe("ok");
    expect(seen).toEqual([[{ currency: "USD", time: "2026-03-10T08:45:00.000Z" }]]);
    const alerts = s.listAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      status: "READY",
      readyAt: iso(Date.parse(breakout.time) + M15),
      paperStatus: "OPEN",
      notifyState: "PENDING", // LIVE here, so READY entered the outbox in the same write (london-break itself runs in TEST)
    });
  });
});
