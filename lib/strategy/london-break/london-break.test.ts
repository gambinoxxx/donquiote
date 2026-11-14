import { describe, expect, it } from "vitest";
import type { Pair } from "@/lib/types";
import { resolvePaperTrade, timeExitAt, NOTE_TIME_EXIT } from "@/lib/paper/resolve";
import { m15, replay, waveCandles } from "../__fixtures__/candles";
import { atr } from "../gemini-fvg/indicators";
import type { RedNewsEvent } from "../types";
import {
  ATR_PERIOD,
  EXIT_AT_UTC_HOUR,
  asianRange,
  filterDirection,
  inBreakoutWindow,
  londonBreak,
  REWARD_RATIO,
} from "./index";

type Row = readonly [number, number, number, number]; // open, high, low, close

const H4_MS = 4 * 3_600_000;
const DAY = "2026-03-10"; // a Tuesday
const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;

const QUIET: Row = [1.1015, 1.102, 1.101, 1.1015];
/** 28 Asian candles (00:00–06:45) between `low` and `high`. */
function asian(low: number, high: number): Row[] {
  return Array.from({ length: 28 }, (_, i): Row => {
    if (i === 5) return [1.1015, high, 1.101, 1.1015];
    if (i === 20) return [1.1015, 1.102, low, 1.1015];
    return QUIET;
  });
}
const ASIA = asian(1.1, 1.103); // 30-pip range

// Breakout candles (EUR_USD prices).
const BUY_BREAK: Row = [1.1025, 1.105, 1.1022, 1.1048]; // body 23, range 28, close 18 pips above 1.10300
const SELL_BREAK: Row = [1.1005, 1.1008, 1.098, 1.0982]; // mirror below 1.10000
const BIG_BUY: Row = [1.102, 1.106, 1.1018, 1.1058]; // stop 1.10160 → 42 pips
const WEAK_BUY: Row = [1.1035, 1.106, 1.102, 1.1045]; // body 10 of 40 = 25%
const SMALL_BODY_BUY: Row = [1.1023, 1.1032, 1.1022, 1.1031]; // body 8 pips (80% of range) < ATR

/** 60 closed 4H candles ending before the day: closes rising (UP) or falling (DOWN). */
function fourHour(trend: "UP" | "DOWN", scale = 1) {
  const values = Array.from({ length: 60 }, (_, i) => 1.09 + (trend === "UP" ? i : 59 - i) * 0.0002);
  const start = new Date(Date.parse(at("00:00")) - 60 * H4_MS).toISOString();
  return waveCandles(values.map((v) => v * scale), 0.001 * scale, start, H4_MS, scale === 1 ? 5 : 3);
}

function run(
  rows: readonly Row[],
  options: { trend?: "UP" | "DOWN"; pair?: Pair; scale?: number; asia?: readonly Row[]; redNews?: RedNewsEvent[] } = {},
) {
  const scale = options.scale ?? 1;
  const decimals = scale === 1 ? 5 : 3;
  const s = (n: number) => Number((n * scale).toFixed(decimals));
  return replay(londonBreak, {
    pair: options.pair ?? "EUR_USD",
    D: [],
    H4: fourHour(options.trend ?? "UP", scale),
    M15: m15(at("00:00"), [...(options.asia ?? ASIA), ...rows].map(([o, h, l, c]) => [s(o), s(h), s(l), s(c)] as const)),
    ...(options.redNews && { redNews: options.redNews }),
  });
}

describe("london-break helpers", () => {
  it("fixtures: Asian range 30 pips, 4H filter UP / DOWN, window 07:00–10:00", () => {
    const candles = m15(at("00:00"), ASIA);
    expect(asianRange(candles, at("07:00"), "EUR_USD")).toEqual({ high: 1.103, low: 1.1, pips: 30 });
    expect(filterDirection(fourHour("UP"))).toBe("BUY");
    expect(filterDirection(fourHour("DOWN"))).toBe("SELL");
    expect(filterDirection(fourHour("UP").slice(0, 50))).toBeNull(); // needs more than 50 candles
    expect(inBreakoutWindow(at("06:45"))).toBe(false);
    expect(inBreakoutWindow(at("07:00"))).toBe(true);
    expect(inBreakoutWindow(at("09:45"))).toBe(true);
    expect(inBreakoutWindow(at("10:00"))).toBe(false);
  });
});

describe("london-break", () => {
  it("a valid BUY: READY at the breakout close, stop 2 pips below its low, target 1.5R", () => {
    const { steps, openSetups, recentAlerts } = run([QUIET, QUIET, BUY_BREAK]);
    const time = at("07:30");
    const key = `EUR_USD:BUY:${time}`;
    expect(steps).toHaveLength(1);
    expect(steps[0]?.events).toEqual([
      {
        type: "SWEEP",
        pair: "EUR_USD",
        dedupeKey: key,
        direction: "BUY",
        sweepType: "ASH",
        sweepLevel: 1.103,
        sweepExtreme: 1.1022,
        sweepTime: time,
        bosLevel: 1.103,
        expiresAt: at("07:45"),
      },
      {
        type: "CONFIRM",
        dedupeKey: key,
        confirmTime: time,
        ticket: {
          entry: 1.1048,
          stop: 1.102, // 1.10220 − 2 pips
          target: 1.109, // 28 × 1.5 = 42 pips
          stopPips: 28,
          targetPips: 42,
          riskPct: 0.5,
          riskUsd: 50,
          lotSize: 0.17, // $50 ÷ (28 × $10)
        },
      },
    ]);
    // Straight to READY: nothing left Watching, the alert is READY at the candle close.
    expect(openSetups).toEqual([]);
    expect(recentAlerts).toMatchObject([{ status: "READY", readyAt: at("07:45"), entryType: "MARKET" }]);
    expect(REWARD_RATIO).toBe(1.5);
  });

  it("a valid SELL in a 4H downtrend", () => {
    const { steps } = run([QUIET, SELL_BREAK], { trend: "DOWN" });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.events[0]).toMatchObject({ type: "SWEEP", direction: "SELL", sweepType: "ASL", sweepLevel: 1.1, sweepExtreme: 1.1008 });
    expect(steps[0]?.events[1]).toMatchObject({
      type: "CONFIRM",
      confirmTime: at("07:15"),
      ticket: { entry: 1.0982, stop: 1.101, target: 1.094, stopPips: 28, targetPips: 42, lotSize: 0.17 },
    });
  });

  it("Asian range under 15 pips → no trade", () => {
    const narrow = asian(1.101, 1.102); // 10 pips
    expect(run([QUIET, BUY_BREAK], { asia: narrow }).steps).toEqual([]);
  });

  it("Asian range over 60 pips → no trade", () => {
    const wide = asian(1.098, 1.1045); // 65 pips
    expect(run([QUIET, [1.1025, 1.1075, 1.1047, 1.1073]], { asia: wide }).steps).toEqual([]);
  });

  it("a breakout outside 07:00–10:00 is ignored", () => {
    const quietMorning = Array.from({ length: 12 }, () => QUIET); // 07:00–09:45
    expect(run([...quietMorning, BUY_BREAK]).steps).toEqual([]); // 10:00
  });

  it("the first breakout is against the 4H filter → no trade that day, later breakouts ignored", () => {
    // BUY breakout first in a 4H downtrend; a valid SELL breakout follows.
    const { steps } = run([BUY_BREAK, QUIET, QUIET, SELL_BREAK], { trend: "DOWN" });
    expect(steps).toEqual([]);
  });

  it("a weak breakout candle (body under 50% of its range) does not count", () => {
    expect(run([QUIET, WEAK_BUY]).steps).toEqual([]);
  });

  it("a breakout body under 1 × ATR14 does not count", () => {
    const candles = m15(at("00:00"), [...ASIA, QUIET]);
    const atrBefore = atr(candles, ATR_PERIOD).at(-1) as number;
    expect(Math.abs(SMALL_BODY_BUY[3] - SMALL_BODY_BUY[0])).toBeLessThan(atrBefore);
    expect(run([QUIET, SMALL_BODY_BUY]).steps).toEqual([]);
  });

  it("a weak candle doesn't use up the day: the next qualifying breakout trades", () => {
    const { steps } = run([WEAK_BUY, QUIET, BUY_BREAK]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.time).toBe(at("07:30"));
  });

  it("a stop outside 8–30 pips → skipped (Expired with the reason), no trade that day", () => {
    const { steps, recentAlerts } = run([QUIET, BIG_BUY, QUIET, BUY_BREAK]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.events).toEqual([
      expect.objectContaining({ type: "SWEEP", direction: "BUY", sweepTime: at("07:15") }),
      { type: "SKIP_INVALID", dedupeKey: `EUR_USD:BUY:${at("07:15")}`, reason: "Stop 42.0 pips is outside 8–30 pips" },
    ]);
    expect(recentAlerts.map((a) => a.status)).toEqual(["EXPIRED"]);
  });

  it("a second breakout the same day is ignored", () => {
    const higher: Row = [1.1048, 1.1075, 1.1046, 1.1073];
    const { steps } = run([BUY_BREAK, QUIET, higher, SELL_BREAK]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.time).toBe(at("07:00"));
  });

  it("red news within 30 min of the breakout close → skipped; 31 min away → trades", () => {
    const close = Date.parse(at("07:30"));
    const near: RedNewsEvent[] = [{ currency: "USD", time: new Date(close + 30 * 60_000).toISOString() }];
    const skipped = run([QUIET, BUY_BREAK], { redNews: near });
    expect(skipped.steps[0]?.events.map((e) => e.type)).toEqual(["SWEEP", "SKIP_INVALID"]);
    expect(skipped.steps[0]?.events[1]).toMatchObject({ reason: "Red USD news within 30 min" });

    const earlier: RedNewsEvent[] = [{ currency: "EUR", time: new Date(close - 20 * 60_000).toISOString() }];
    expect(run([QUIET, BUY_BREAK], { redNews: earlier }).steps[0]?.events[1]).toMatchObject({ type: "SKIP_INVALID", reason: "Red EUR news within 30 min" });

    const far: RedNewsEvent[] = [
      { currency: "USD", time: new Date(close + 31 * 60_000).toISOString() },
      { currency: "JPY", time: new Date(close).toISOString() }, // not this pair's currency
    ];
    expect(run([QUIET, BUY_BREAK], { redNews: far }).steps[0]?.events[1]).toMatchObject({ type: "CONFIRM" });
  });

  it("USD_JPY uses a 0.01 pip: same pip counts at 100× prices, JPY lot size", () => {
    const { steps } = run([QUIET, BUY_BREAK], { pair: "USD_JPY", scale: 100 });
    expect(steps[0]?.events[0]).toMatchObject({ type: "SWEEP", dedupeKey: `USD_JPY:BUY:${at("07:15")}`, sweepLevel: 110.3 });
    expect(steps[0]?.events[1]).toMatchObject({
      type: "CONFIRM",
      ticket: { entry: 110.48, stop: 110.2, target: 110.9, stopPips: 28, targetPips: 42, lotSize: 0.19 }, // $50 ÷ (28 × 1000 / 110.48)
    });
  });

  it("time exit: still open at 16:00 UTC → Unresolved at the 15:45 candle's close, with its R", () => {
    const { steps } = run([QUIET, BUY_BREAK]);
    const confirm = steps[0]?.events[1];
    if (confirm?.type !== "CONFIRM") throw new Error("expected CONFIRM");
    const openedAt = at("07:30"); // close of the 07:15 breakout candle
    const exitAt = timeExitAt(openedAt, EXIT_AT_UTC_HOUR);
    expect(exitAt).toBe(at("16:00"));
    // Quiet candles 07:30 → 16:15, never reaching the stop (1.10200) or target (1.10900).
    const after = m15(at("07:30"), Array.from({ length: 36 }, (): Row => [1.105, 1.106, 1.104, 1.1055]));
    const trade = {
      pair: "EUR_USD" as const,
      direction: "BUY" as const,
      entry: confirm.ticket.entry,
      stop: confirm.ticket.stop,
      target: confirm.ticket.target,
      riskUsd: confirm.ticket.riskUsd,
      openedAt,
      exitAt,
    };
    expect(resolvePaperTrade(trade, after.slice(0, 33)).status).toBe("OPEN"); // up to 15:30's close
    expect(resolvePaperTrade(trade, after)).toEqual({
      status: "UNRESOLVED",
      exitPrice: 1.1055,
      closedAt: at("16:00"),
      resultR: 0.25, // +7 pips over a 28-pip stop
      pnlUsd: 12.5,
      note: NOTE_TIME_EXIT,
    });
  });
});
