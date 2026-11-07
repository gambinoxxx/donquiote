import { describe, expect, it } from "vitest";
import type { Pair } from "@/lib/types";
import { EUR_DOWN, EUR_UP, m15, replay, waveCandles } from "../__fixtures__/candles";
import { getTrend } from "../shared/trend";
import { inSession, proV1Swing } from "./index";

type Row = readonly [number, number, number, number]; // open, high, low, close

const DAY_MS = 24 * 3_600_000;
const H4_MS = 4 * 3_600_000;
const round5 = (n: number) => Number(n.toFixed(5));

// 32 values, lower highs and lower lows at the end (dg-v1's EUR fixture,
// preceded by a higher copy so there are more than 25 candles). Last value
// 1.10500 is the previous day / last 4H candle.
const DOWN = [...EUR_DOWN.map((v) => round5(v + 0.02)), ...EUR_DOWN];
const UP = [...EUR_UP.map((v) => round5(v - 0.02)), ...EUR_UP];

/** Daily candles ending with the previous forex day (opens Mon 2 Nov 22:00 UTC): PDH 1.10700. */
const daily = (values: readonly number[], scale = 1) =>
  waveCandles(values.map((v) => v * scale), 0.002 * scale, new Date(Date.parse("2026-11-02T22:00:00.000Z") - 31 * DAY_MS).toISOString(), DAY_MS, scale === 1 ? 5 : 3);
/** 4H candles, the last one closing at 06:00 UTC on 4 Nov: last 4H high 1.10600. */
const fourHour = (values: readonly number[], scale = 1) =>
  waveCandles(values.map((v) => v * scale), 0.001 * scale, new Date(Date.parse("2026-11-04T02:00:00.000Z") - 31 * H4_MS).toISOString(), H4_MS, scale === 1 ? 5 : 3);

const QUIET: Row = [1.104, 1.1045, 1.1035, 1.104];
const SWEEP_PDH: Row = [1.105, 1.1075, 1.1048, 1.1068]; // above PDH 1.10700, closes back inside (< +1 pip)
const BREAK: Row = [1.1068, 1.1068, 1.1058, 1.106]; // close 1.10600 ≤ 1.10700 − 0.5 pip

function run(rows: Row[], options: { start?: string; pair?: Pair; h4?: readonly number[]; scale?: number } = {}) {
  const scale = options.scale ?? 1;
  const s = (n: number) => Number((n * scale).toFixed(scale === 1 ? 5 : 3));
  return replay(proV1Swing, {
    pair: options.pair ?? "EUR_USD",
    D: daily(DOWN, scale),
    H4: fourHour(options.h4 ?? DOWN, scale),
    M15: m15(options.start ?? "2026-11-04T06:00:00.000Z", rows.map(([o, h, l, c]) => [s(o), s(h), s(l), s(c)] as const)),
  });
}
const morning = (rows: Row[]) => [QUIET, QUIET, QUIET, QUIET, ...rows]; // 06:00–06:45, then 07:00…

describe("pro-v1-swing", () => {
  it("fixtures: D and 4H swing trends are both DOWN with more than 25 candles", () => {
    expect(getTrend(daily(DOWN), 2)).toBe("DOWN");
    expect(getTrend(fourHour(DOWN), 2)).toBe("DOWN");
    expect(getTrend(fourHour(UP), 2)).toBe("UP");
    expect(daily(DOWN).length).toBeGreaterThan(25);
  });

  it("PDH swept and closed back inside, then a close 0.5 pip beyond → READY at that close", () => {
    const { steps } = run(morning([SWEEP_PDH, BREAK]));
    const sweepTime = "2026-11-04T07:00:00.000Z";
    const key = `EUR_USD:SELL:${sweepTime}`;
    expect(steps).toHaveLength(2);
    const [sweep] = steps[0]?.events ?? [];
    expect(sweep).toMatchObject({
      type: "SWEEP",
      dedupeKey: key,
      direction: "SELL",
      sweepType: "PDH",
      sweepLevel: 1.107,
      sweepExtreme: 1.1075,
      sweepTime,
      expiresAt: "2026-11-04T09:15:00.000Z", // 8 candles after the sweep candle
    });
    expect(sweep?.type === "SWEEP" && sweep.bosLevel).toBeCloseTo(1.10695, 10);
    expect(steps[1]?.events).toEqual([
      {
        type: "CONFIRM",
        dedupeKey: key,
        confirmTime: "2026-11-04T07:15:00.000Z",
        ticket: {
          entry: 1.106,
          stop: 1.1078, // 1.10750 + 3 pips
          target: 1.1006, // 18 × 3 = 54 pips
          stopPips: 18,
          targetPips: 54,
          riskPct: 0.5,
          riskUsd: 50,
          lotSize: 0.27, // $50 ÷ 180 = 0.277
        },
      },
    ]);
  });

  it("the last closed 4H high is liquidity too", () => {
    const SWEEP_H4: Row = [1.105, 1.1064, 1.1048, 1.106]; // above 4H high 1.10600, below PDH
    const BREAK_H4: Row = [1.106, 1.1062, 1.1048, 1.105];
    const { events } = run(morning([SWEEP_H4, BREAK_H4]));
    expect(events[0]).toMatchObject({ type: "SWEEP", sweepType: "H4H", sweepLevel: 1.106 });
    expect(events[1]).toMatchObject({ type: "CONFIRM", ticket: { entry: 1.105, stop: 1.1067, stopPips: 17 } });
  });

  it("a sweep that closes more than 1 pip beyond the level does not count", () => {
    const CLOSES_ABOVE: Row = [1.105, 1.1075, 1.1048, 1.1072]; // close 1.10720 ≥ 1.10700 + 1 pip
    expect(run(morning([CLOSES_ABOVE, QUIET, QUIET])).events).toEqual([]);
  });

  it("outside 07:00–16:00 UTC: no sweep", () => {
    const { events } = run([QUIET, QUIET, SWEEP_PDH, BREAK], { start: "2026-11-04T15:30:00.000Z" }); // sweep 16:00
    expect(events).toEqual([]);
    expect(inSession("2026-11-04T06:45:00.000Z")).toBe(false);
    expect(inSession("2026-11-04T15:45:00.000Z")).toBe(true);
    expect(inSession("2026-11-04T16:00:00.000Z")).toBe(false);
  });

  it("D and 4H trends disagree: no sweep", () => {
    expect(run(morning([SWEEP_PDH, BREAK]), { h4: UP }).events).toEqual([]);
  });

  it("stop wider than 35 pips → SKIP_INVALID", () => {
    const WIDE: Row = [1.105, 1.111, 1.1048, 1.1068]; // extreme 1.11100 → stop 1.11130, 53 pips
    const { events } = run(morning([WIDE, BREAK]));
    expect(events.map((e) => e.type)).toEqual(["SWEEP", "SKIP_INVALID"]);
    expect(events[1]).toMatchObject({ reason: "Stop 53.0 pips is outside 6–35 pips" });
  });

  it("stop tighter than 6 pips → SKIP_INVALID", () => {
    const TIGHT_SWEEP: Row = [1.1065, 1.1071, 1.1064, 1.1069]; // extreme 1.10710
    const TIGHT_BREAK: Row = [1.1069, 1.1069, 1.1068, 1.10694]; // close 1.10694 → stop 1.10740, 4.6 pips
    const { events } = run(morning([TIGHT_SWEEP, TIGHT_BREAK]));
    expect(events.map((e) => e.type)).toEqual(["SWEEP", "SKIP_INVALID"]);
    expect(events[1]).toMatchObject({ reason: "Stop 4.6 pips is outside 6–35 pips" });
  });

  it("one trade per pair per forex day: a second setup the same day is ignored", () => {
    const { steps } = run(morning([SWEEP_PDH, BREAK, QUIET, QUIET, SWEEP_PDH, BREAK]));
    expect(steps.map((s) => s.events.map((e) => e.type))).toEqual([["SWEEP"], ["CONFIRM"]]);
  });

  it("a skipped setup does not use up the day", () => {
    const WIDE: Row = [1.105, 1.111, 1.1048, 1.1068];
    const { events } = run(morning([WIDE, BREAK, QUIET, QUIET, SWEEP_PDH, BREAK]));
    expect(events.map((e) => e.type)).toEqual(["SWEEP", "SKIP_INVALID", "SWEEP", "CONFIRM"]);
  });

  it("no break within 8 candles → EXPIRE", () => {
    const HOLDS: Row = [1.1068, 1.107, 1.10696, 1.10698]; // closes stay above 1.10695
    const { steps } = run(morning([SWEEP_PDH, ...Array.from({ length: 9 }, () => HOLDS)]));
    expect(steps.map((s) => [s.time.slice(11, 16), s.events.map((e) => e.type)])).toEqual([
      ["07:00", ["SWEEP"]],
      ["09:15", ["EXPIRE"]],
    ]);
  });

  it("USD_JPY: pips are 0.01 (stop buffer 0.03, range 6–35 pips)", () => {
    const { events } = run(morning([SWEEP_PDH, BREAK]), { pair: "USD_JPY", scale: 100 });
    expect(events[1]).toMatchObject({
      type: "CONFIRM",
      // entry 110.600, stop 110.750 + 0.03 = 110.780 → 18 pips; lot $50 ÷ (18 × 1000/110.6) = 0.307 → 0.30
      ticket: { entry: 110.6, stop: 110.78, stopPips: 18, target: 110.06, lotSize: 0.3 },
    });
  });
});
