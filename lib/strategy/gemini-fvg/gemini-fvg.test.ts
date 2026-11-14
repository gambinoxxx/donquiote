import { describe, expect, it } from "vitest";
import type { Candle, Pair } from "@/lib/types";
import { m15, replay, waveCandles } from "../__fixtures__/candles";
import { atr, ema } from "./indicators";
import { geminiFvg2r } from "../gemini-fvg-2r";
import type { Strategy } from "../types";
import { geminiFvg, inSweepSession } from "./index";

type Row = readonly [number, number, number, number]; // open, high, low, close

const H4_MS = 4 * 3_600_000;
const DAY = "2026-11-04T00:00:00.000Z"; // Wednesday; M15 candles start at 00:00 UTC

/** 60 closed 4H candles at `level` (EMA50 = level), the last closing at 00:00. */
const h4At = (level: number, decimals = 5) =>
  waveCandles(Array<number>(60).fill(level), 0, new Date(Date.parse(DAY) - 60 * H4_MS).toISOString(), H4_MS, decimals);
/** Previous forex day: PDH 1.10800, PDL 1.09500. */
const dayCandle = (high: number, low: number): Candle[] => [
  { time: "2026-11-02T22:00:00.000Z", open: (high + low) / 2, high, low, close: (high + low) / 2 },
];

const QUIET: Row = [1.102, 1.1025, 1.1015, 1.102];
/** 00:00–07:15 UTC: quiet, Asian high 1.10300 at 01:15. */
function morning(): Row[] {
  const rows: Row[] = Array.from({ length: 30 }, () => QUIET);
  rows[5] = [1.102, 1.103, 1.1015, 1.102];
  return rows;
}
const SWEEP: Row = [1.102, 1.1034, 1.1015, 1.1022]; // 07:30 sweeps the Asian high, close below EMA 1.10500
const BEFORE: Row = [1.1022, 1.1026, 1.1016, 1.1018]; // 07:45, low 1.10160
const DISPLACEMENT: Row = [1.1018, 1.102, 1.0985, 1.099]; // 08:00 body 35 pips
const GAP: Row = [1.099, 1.1005, 1.098, 1.0995]; // 08:15 high 1.10050 < 1.10160 → gap
const BELOW: Row = [1.099, 1.1, 1.098, 1.0995]; // under the limit entry

function run(rows: Row[], options: { pair?: Pair; h4Level?: number; scale?: number; strategy?: Strategy } = {}) {
  const scale = options.scale ?? 1;
  const decimals = scale === 1 ? 5 : 3;
  const s = (n: number) => Number((n * scale).toFixed(decimals));
  return replay(options.strategy ?? geminiFvg, {
    pair: options.pair ?? "EUR_USD",
    D: dayCandle(s(1.108), s(1.095)),
    H4: h4At(s(options.h4Level ?? 1.105), decimals),
    M15: m15(DAY, rows.map(([o, h, l, c]) => [s(o), s(h), s(l), s(c)] as const)),
  });
}

const SWEEP_TIME = "2026-11-04T07:30:00.000Z";
const KEY = `EUR_USD:SELL:${SWEEP_TIME}`;

describe("gemini-fvg", () => {
  it("Asian high swept in session, then displacement + fair value gap → READY with a LIMIT entry at the gap", () => {
    const { steps } = run([...morning(), SWEEP, BEFORE, DISPLACEMENT, GAP]);
    expect(steps.map((s) => s.events)).toEqual([
      [
        {
          type: "SWEEP",
          pair: "EUR_USD",
          dedupeKey: KEY,
          direction: "SELL",
          sweepType: "ASH",
          sweepLevel: 1.103,
          sweepExtreme: 1.1034,
          sweepTime: SWEEP_TIME,
          bosLevel: 1.103, // no BOS in this strategy: the swept level
          expiresAt: "2026-11-04T10:00:00.000Z", // sweep + gap candle + 8 candles
        },
      ],
      [
        {
          type: "CONFIRM",
          dedupeKey: KEY,
          confirmTime: "2026-11-04T08:15:00.000Z",
          ticket: {
            entry: 1.1005, // the gap candle's high
            stop: 1.1036, // sweep extreme 1.10340 + 2 pips
            target: 1.0912, // 31 × 3 = 93 pips
            stopPips: 31,
            targetPips: 93,
            riskPct: 0.5,
            riskUsd: 50,
            lotSize: 0.16,
          },
          entryType: "LIMIT",
          entryValidUntil: "2026-11-04T12:30:00.000Z", // 16 candles after Ready (08:30)
        },
      ],
    ]);
  });

  it("a sweep outside 07–11 / 13–17 UTC is ignored", () => {
    const rows = [...morning(), ...Array.from({ length: 18 }, () => QUIET)]; // to 11:45
    rows.push(SWEEP, BEFORE, DISPLACEMENT, GAP); // 12:00 sweep
    expect(run(rows).events).toEqual([]);
    expect(inSweepSession("2026-11-04T11:00:00.000Z")).toBe(false);
    expect(inSweepSession("2026-11-04T13:00:00.000Z")).toBe(true);
    expect(inSweepSession("2026-11-04T17:00:00.000Z")).toBe(false);
  });

  it("no fair value gap → no READY; the setup expires after the 8-candle window", () => {
    const NO_GAP: Row = [1.099, 1.1018, 1.098, 1.0995]; // high 1.10180 ≥ 1.10160: no gap
    const rows = [...morning(), SWEEP, BEFORE, DISPLACEMENT, NO_GAP, ...Array.from({ length: 8 }, () => BELOW)];
    const { steps } = run(rows);
    expect(steps.map((s) => s.events.map((e) => e.type))).toEqual([["SWEEP"], ["EXPIRE"]]);
    expect(steps[1]?.time).toBe("2026-11-04T10:00:00.000Z"); // first candle closing after 10:00
  });

  it("a candle body under 1.5 × ATR14 is not displacement", () => {
    const SMALL: Row = [1.1018, 1.102, 1.1004, 1.1006]; // body 12 pips, ATR ≈ 10 pips → 15 needed
    const GAP_AFTER_SMALL: Row = [1.1006, 1.1008, 1.1, 1.1004]; // high below 1.10160 anyway
    const { events } = run([...morning(), SWEEP, BEFORE, SMALL, GAP_AFTER_SMALL]);
    expect(events.map((e) => e.type)).toEqual(["SWEEP"]);
  });

  it("direction comes from the 4H EMA50: price above it → buys only, so the high sweep is ignored", () => {
    const { steps } = run([...morning(), SWEEP, BEFORE, DISPLACEMENT, GAP], { h4Level: 1.099 });
    // 07:30 trades above the Asian high: nothing. 08:00 trades below the
    // Asian low 1.10150 → a BUY setup.
    expect(steps.map((s) => s.events[0])).toEqual([
      expect.objectContaining({ type: "SWEEP", direction: "BUY", sweepType: "ASL", sweepTime: "2026-11-04T08:00:00.000Z" }),
      expect.objectContaining({ type: "EXTEND" }),
    ]);
    expect(steps.flatMap((s) => s.events).some((e) => e.type === "SWEEP" && e.direction === "SELL")).toBe(false);
  });

  it("a level counts once per forex day", () => {
    const NO_GAP: Row = [1.099, 1.1018, 1.098, 1.0995];
    const rows = [...morning(), SWEEP, BEFORE, DISPLACEMENT, NO_GAP, ...Array.from({ length: 8 }, () => BELOW)];
    rows.push(SWEEP); // 10:15: the Asian high again, after the first setup expired
    expect(run(rows).events.map((e) => e.type)).toEqual(["SWEEP", "EXPIRE"]);
  });

  it("one trade at a time: no new sweep until the open trade is decided", () => {
    const PDH_SWEEP: Row = [1.1, 1.1085, 1.0998, 1.104]; // fills 1.10050, touches stop 1.10360 and sweeps PDH 1.10800
    const rows = [...morning(), SWEEP, BEFORE, DISPLACEMENT, GAP, BELOW, BELOW, PDH_SWEEP, PDH_SWEEP];
    const { steps } = run(rows);
    // 09:00: the trade (Ready 08:30) is still open before this candle → ignored.
    // 09:15: it lost on the 09:00 candle → free again, PDH is fresh → new sweep.
    expect(steps.map((s) => [s.time.slice(11, 16), s.events.map((e) => e.type)])).toEqual([
      ["07:30", ["SWEEP"]],
      ["08:15", ["CONFIRM"]],
      ["09:15", ["SWEEP"]],
    ]);
    expect(steps[2]?.events[0]).toMatchObject({ sweepType: "PDH", sweepLevel: 1.108 });
  });

  it("USD_JPY: the 2-pip stop buffer is 0.02", () => {
    const { steps } = run([...morning(), SWEEP, BEFORE, DISPLACEMENT, GAP], { pair: "USD_JPY", scale: 100 });
    expect(steps[1]?.events[0]).toMatchObject({
      type: "CONFIRM",
      // entry 110.050, stop 110.340 + 0.02 = 110.360 → 31 pips; lot $50 ÷ (31 × 1000/110.05) = 0.177 → 0.17
      ticket: { entry: 110.05, stop: 110.36, stopPips: 31, target: 109.12, lotSize: 0.17 },
      entryType: "LIMIT",
    });
  });
});

describe("gemini-fvg indicators", () => {
  it("ema is seeded with the first value", () => {
    expect(ema([10, 10, 10], 50)).toEqual([10, 10, 10]);
    const [a, b] = ema([10, 20], 3); // α = 0.5
    expect(a).toBe(10);
    expect(b).toBe(15);
  });

  it("atr starts at 0 and smooths the true range by 1/period", () => {
    const bars = [
      { high: 1.1, low: 1.0, close: 1.05 },
      { high: 1.2, low: 1.1, close: 1.15 }, // TR = 1.2 − 1.05 = 0.15
    ];
    const [first, second] = atr(bars, 14);
    expect(first).toBe(0);
    expect(second).toBeCloseTo(0.15 / 14, 12);
  });
});

describe("gemini-fvg-2r (same rules, target 2R)", () => {
  it("fires on the same setup with the same entry, stop and lot size; only the target is 2R", () => {
    const rows = [...morning(), SWEEP, BEFORE, DISPLACEMENT, GAP];
    const fvg = run(rows).steps.map((s) => s.events);
    const fvg2 = run(rows, { strategy: geminiFvg2r }).steps.map((s) => s.events);
    expect(fvg2[0]).toEqual(fvg[0]);
    expect(fvg2[1]).toEqual([
      {
        ...(fvg[1]?.[0] as object),
        ticket: {
          entry: 1.1005,
          stop: 1.1036,
          target: 1.0943, // 31 × 2 = 62 pips
          stopPips: 31,
          targetPips: 62,
          riskPct: 0.5,
          riskUsd: 50,
          lotSize: 0.16,
        },
      },
    ]);
    expect(geminiFvg.rewardRatio).toBe(3);
    expect(geminiFvg2r.rewardRatio).toBe(2);
  });
});
