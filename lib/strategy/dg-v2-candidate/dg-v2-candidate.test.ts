import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/types";
import {
  daily,
  EUR_DOWN,
  EUR_HALF_RANGE,
  EUR_UP,
  h4,
  JPY_HALF_RANGE,
  JPY_UP,
  m15,
  M15_START,
  replay,
} from "../__fixtures__/candles";
import { dgV1 } from "../dg-v1";
import { toHourly } from "../shared/hourly";
import { asianSessionEnd } from "./levels";
import { dgV2Candidate } from "./index";

type Row = readonly [number, number, number, number]; // open, high, low, close

const D_DOWN = daily(EUR_DOWN, EUR_HALF_RANGE); // PDH 1.10700, PDL 1.10300
const H4_DOWN = h4(EUR_DOWN, EUR_HALF_RANGE);
const H4_UP = h4(EUR_UP, EUR_HALF_RANGE);
const D_UP = daily(EUR_UP, EUR_HALF_RANGE); // PDH 1.10700, PDL 1.10300

// dg-v1's scenario 1: a PDH sweep (23:30 UTC, before the Asian session ends).
const BEFORE_SWEEP: Row[] = [
  [1.1035, 1.104, 1.103, 1.1032],
  [1.1032, 1.1035, 1.1025, 1.1028],
  [1.1028, 1.103, 1.1015, 1.1025],
  [1.103, 1.104, 1.1028, 1.1035],
  [1.1035, 1.105, 1.1035, 1.1045],
  [1.1045, 1.106, 1.1045, 1.1055],
];
const SWEEP_PDH: Row = [1.1055, 1.1078, 1.105, 1.106];
const BODY_CLOSE_BELOW: Row = [1.1058, 1.1062, 1.1005, 1.101];

const QUIET: Row = [1.104, 1.1045, 1.1035, 1.104];

/**
 * 22:00–06:45 UTC (the Asian session of the forex day that opened at 22:00):
 * quiet candles, the session high 1.10520 at 00:30 and a swing low 1.10250
 * at 05:30 (the BOS level), then 07:00 and 07:15 quiet.
 */
function asianSession(): Row[] {
  const rows: Row[] = Array.from({ length: 38 }, () => QUIET);
  rows[10] = [1.104, 1.1052, 1.1035, 1.1045];
  rows[30] = [1.104, 1.1045, 1.1025, 1.104];
  return rows;
}

describe("dg-v2-candidate", () => {
  it("a PDH sweep behaves exactly like dg-v1 (same sweep, BOS, ticket)", () => {
    const rows = [...BEFORE_SWEEP, SWEEP_PDH, BODY_CLOSE_BELOW];
    const args = { pair: "EUR_USD" as const, D: D_DOWN, H4: H4_DOWN, M15: m15(M15_START, rows) };
    const v2 = replay(dgV2Candidate, args);
    expect(v2.events.map((e) => e.type)).toEqual(["SWEEP", "CONFIRM"]);
    expect(v2.steps).toEqual(replay(dgV1, args).steps);
  });

  it("the Asian session high, swept after 07:00 UTC, gives a SELL that reaches READY", () => {
    const rows: Row[] = [
      ...asianSession(),
      [1.104, 1.1056, 1.1038, 1.1046], // 07:30 sweeps the Asian high 1.10520
      [1.1046, 1.1048, 1.1018, 1.102], // 07:45 body close below the swing low 1.10250
    ];
    const { steps } = replay(dgV2Candidate, { pair: "EUR_USD", D: D_DOWN, H4: H4_DOWN, M15: m15(M15_START, rows) });
    const sweepTime = "2026-11-04T07:30:00.000Z";
    const key = `EUR_USD:SELL:${sweepTime}`;
    expect(steps.map((s) => s.events)).toEqual([
      [
        {
          type: "SWEEP",
          pair: "EUR_USD",
          dedupeKey: key,
          direction: "SELL",
          sweepType: "ASH",
          sweepLevel: 1.1052,
          sweepExtreme: 1.1056,
          sweepTime,
          bosLevel: 1.1025,
          expiresAt: "2026-11-04T09:45:00.000Z", // close 07:45 + 120 min
        },
      ],
      [
        {
          type: "CONFIRM",
          dedupeKey: key,
          confirmTime: "2026-11-04T07:45:00.000Z",
          ticket: {
            entry: 1.102,
            stop: 1.1059, // 1.10560 + 3 pips
            target: 1.0903, // 39 × 3 = 117 pips
            stopPips: 39,
            targetPips: 117,
            riskPct: 0.5,
            riskUsd: 50,
            lotSize: 0.12, // $50 ÷ 390 = 0.128
          },
        },
      ],
    ]);
  });

  it("before 07:00 UTC the Asian range is not a level yet", () => {
    const rows = asianSession().slice(0, 34);
    rows.push([1.104, 1.1056, 1.1038, 1.1046]); // 06:30: above the session high so far
    const { events } = replay(dgV2Candidate, { pair: "EUR_USD", D: D_DOWN, H4: H4_DOWN, M15: m15(M15_START, rows) });
    expect(events).toEqual([]);
  });

  it("1H equal lows are liquidity (dg-v1, with no 15m equal lows here, sees nothing)", () => {
    // One row per hour (4 identical M15 candles); 1H swing lows 1.10400 (02:00)
    // and 1.10410 (06:00) are equal within 2 pips → EQL 1.10400. Asian low
    // 1.10350 (23:00) stays below it. 08:15 is the M15 swing high (BOS).
    const hourLows = [1.105, 1.1035, 1.105, 1.1045, 1.104, 1.1045, 1.105, 1.1045, 1.1041, 1.1045, 1.105];
    const rows: Row[] = hourLows.flatMap((low) => Array.from({ length: 4 }, (): Row => [low + 0.0005, low + 0.001, low, low + 0.0005]));
    rows[41] = [1.1055, 1.1075, 1.105, 1.1055]; // 08:15 swing high 1.10750
    rows.push([1.1045, 1.105, 1.1038, 1.1044]); // 09:00 sweeps EQL 1.10400
    rows.push([1.1044, 1.108, 1.1042, 1.1078]); // 09:15 body close above 1.10750
    const args = { pair: "EUR_USD" as const, D: D_UP, H4: H4_UP, M15: m15(M15_START, rows) };

    const { steps } = replay(dgV2Candidate, args);
    expect(steps.map((s) => s.events.map((e) => e.type))).toEqual([["SWEEP"], ["CONFIRM"]]);
    expect(steps[0]?.events[0]).toMatchObject({ direction: "BUY", sweepType: "EQL", sweepLevel: 1.104, bosLevel: 1.1075 });
    expect(steps[1]?.events[0]).toMatchObject({
      ticket: { entry: 1.1078, stop: 1.1035, stopPips: 43, target: 1.1207, lotSize: 0.11 },
    });
    expect(replay(dgV1, args).events).toEqual([]);
  });

  it("ignores 15m equal lows that dg-v1 trades", () => {
    // dg-v1's scenario 6 (USD_JPY): a sweep of 15m equal lows.
    const rows: Row[] = [
      [157.05, 157.1, 157.0, 157.02],
      [157.02, 157.05, 156.95, 157.0],
      [157.0, 157.0, 156.9, 156.95],
      [157.0, 157.1, 156.98, 157.05],
      [157.05, 157.2, 157.05, 157.15],
      [157.15, 157.15, 157.0, 157.05],
      [157.05, 157.05, 156.95, 157.0],
      [157.0, 157.0, 156.915, 156.95],
      [156.97, 157.08, 156.97, 157.05],
      [157.05, 157.1, 157.0, 157.05],
      [157.0, 157.05, 156.88, 156.95],
      [156.96, 157.3, 156.95, 157.25],
    ];
    const args = {
      pair: "USD_JPY" as const,
      D: daily(JPY_UP, JPY_HALF_RANGE, 3),
      H4: h4(JPY_UP, JPY_HALF_RANGE, 3),
      M15: m15(M15_START, rows),
    };
    expect(replay(dgV1, args).events.map((e) => e.type)).toEqual(["SWEEP", "CONFIRM"]);
    expect(replay(dgV2Candidate, args).events).toEqual([]);
  });

  it("D and 4H trends disagree → no setup", () => {
    const rows = [...BEFORE_SWEEP, SWEEP_PDH, BODY_CLOSE_BELOW];
    const { events } = replay(dgV2Candidate, { pair: "EUR_USD", D: D_DOWN, H4: H4_UP, M15: m15(M15_START, rows) });
    expect(events).toEqual([]);
  });

  it("USD_JPY: a PDL sweep gets a ticket in JPY pips (0.01)", () => {
    const rows: Row[] = [
      [156.6, 156.65, 156.55, 156.6],
      [156.6, 156.65, 156.55, 156.6],
      [156.6, 156.75, 156.58, 156.7], // swing high 156.750 (BOS)
      [156.6, 156.65, 156.55, 156.6],
      [156.6, 156.65, 156.55, 156.6],
      [156.5, 156.55, 156.25, 156.4], // sweeps PDL 156.300
      [156.4, 156.8, 156.38, 156.78], // body close above 156.750
    ];
    const { steps } = replay(dgV2Candidate, {
      pair: "USD_JPY",
      D: daily(JPY_UP, JPY_HALF_RANGE, 3),
      H4: h4(JPY_UP, JPY_HALF_RANGE, 3),
      M15: m15(M15_START, rows),
    });
    expect(steps[0]?.events[0]).toMatchObject({ type: "SWEEP", direction: "BUY", sweepType: "PDL", sweepLevel: 156.3 });
    expect(steps[1]?.events[0]).toMatchObject({
      type: "CONFIRM",
      // stop 156.250 − 3 pips (0.03) = 156.220 → 56 pips; target 168 pips above.
      // Lot: $50 ÷ (56 × 1000/156.78 = $357.17) = 0.13998 → 0.13 (rounded down).
      ticket: { entry: 156.78, stop: 156.22, stopPips: 56, targetPips: 168, target: 158.46, lotSize: 0.13 },
    });
  });
});

describe("dg-v2-candidate helpers", () => {
  it("asianSessionEnd: 07:00 UTC of the candle's day, or the next day before the day has started", () => {
    expect(asianSessionEnd("2026-11-04T08:00:00.000Z", "2026-11-03T22:00:00.000Z")).toBe("2026-11-04T07:00:00.000Z");
    expect(asianSessionEnd("2026-11-03T23:00:00.000Z", "2026-11-03T22:00:00.000Z")).toBe("2026-11-04T07:00:00.000Z");
  });

  it("toHourly merges M15 candles by hour and drops the hour still forming", () => {
    const candles: Candle[] = m15("2026-11-04T10:00:00.000Z", [
      [1, 1.2, 0.9, 1.1],
      [1.1, 1.3, 1.0, 1.2],
      [1.2, 1.25, 0.8, 1.0],
      [1.0, 1.1, 0.95, 1.05],
      [1.05, 1.4, 1.0, 1.3], // 11:00, hour not closed by 11:15
    ]);
    expect(toHourly(candles, "2026-11-04T11:15:00.000Z")).toEqual([
      { time: "2026-11-04T10:00:00.000Z", open: 1, high: 1.3, low: 0.8, close: 1.05 },
    ]);
  });
});
