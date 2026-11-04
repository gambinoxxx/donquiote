import { describe, expect, it } from "vitest";
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
  SETTINGS,
} from "../__fixtures__/candles";
import { applyEvents } from "../apply-events";
import { dgV1 } from "./index";

type Row = readonly [number, number, number, number]; // open, high, low, close

const D_DOWN = daily(EUR_DOWN, EUR_HALF_RANGE); // PDH 1.10700, PDL 1.10300
const H4_DOWN = h4(EUR_DOWN, EUR_HALF_RANGE);
const H4_UP = h4(EUR_UP, EUR_HALF_RANGE);

// c2 is a swing low at 1.10150 (the BOS level); c6 sweeps PDH 1.10700.
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
const WICK_ONLY: Row = [1.1058, 1.1062, 1.1005, 1.102];
const FLAT: Row = [1.104, 1.105, 1.103, 1.104];

const SWEEP_TIME = "2026-11-03T23:30:00.000Z"; // c6
const SELL_KEY = `EUR_USD:SELL:${SWEEP_TIME}`;

const sellSweep = {
  type: "SWEEP",
  pair: "EUR_USD",
  dedupeKey: SELL_KEY,
  direction: "SELL",
  sweepType: "PDH",
  sweepLevel: 1.107,
  sweepExtreme: 1.1078,
  sweepTime: SWEEP_TIME,
  bosLevel: 1.1015,
  expiresAt: "2026-11-04T01:45:00.000Z", // close 23:45 + 120 min
} as const;

function runEur(rows: Row[], options: { H4?: typeof H4_DOWN; settings?: typeof SETTINGS } = {}) {
  return replay(dgV1, {
    pair: "EUR_USD",
    D: D_DOWN,
    H4: options.H4 ?? H4_DOWN,
    M15: m15(M15_START, rows),
    settings: options.settings,
  });
}

describe("dg-v1 scenarios", () => {
  it("1. D + H4 down, PDH sweep, body close below the swing low → SWEEP then CONFIRM", () => {
    const { steps, openSetups } = runEur([...BEFORE_SWEEP, SWEEP_PDH, BODY_CLOSE_BELOW]);

    expect(steps).toHaveLength(2);
    expect(steps[0]?.events).toEqual([sellSweep]);
    expect(steps[1]?.events).toEqual([
      {
        type: "CONFIRM",
        dedupeKey: SELL_KEY,
        confirmTime: "2026-11-03T23:45:00.000Z",
        ticket: {
          entry: 1.101,
          stop: 1.1081, // 1.10780 + 3 pips
          target: 1.0797, // 71 pips × 3 = 213 pips below entry
          stopPips: 71,
          targetPips: 213,
          riskPct: 0.5,
          riskUsd: 50,
          lotSize: 0.07, // $50 ÷ (71 × $10) = 0.0704
        },
      },
    ]);
    expect(openSetups).toEqual([]);
  });

  it("2. a wick through the swing low without a close below does not confirm", () => {
    const { events, openSetups } = runEur([...BEFORE_SWEEP, SWEEP_PDH, WICK_ONLY]);
    expect(events.map((e) => e.type)).toEqual(["SWEEP"]);
    expect(openSetups).toHaveLength(1);
  });

  it("3. D down but H4 up → no events at all", () => {
    const { events } = runEur([...BEFORE_SWEEP, SWEEP_PDH, BODY_CLOSE_BELOW], { H4: H4_UP });
    expect(events).toEqual([]);
  });

  it("4. no confirmation before expiresAt → EXPIRE on the first candle closing after it", () => {
    // c7..c14 close at or before 01:45; c15 closes at 02:00.
    const { steps, openSetups } = runEur([...BEFORE_SWEEP, SWEEP_PDH, ...Array<Row>(9).fill(FLAT)]);
    expect(steps.map((s) => [s.index, s.events.map((e) => e.type)])).toEqual([
      [6, ["SWEEP"]],
      [15, ["EXPIRE"]],
    ]);
    expect(steps[1]?.events[0]).toEqual({
      type: "EXPIRE",
      dedupeKey: SELL_KEY,
      time: "2026-11-04T01:45:00.000Z",
    });
    expect(openSetups).toEqual([]);
  });

  it("4b. a body close on the candle that closes exactly at expiresAt still confirms", () => {
    const { steps } = runEur([
      ...BEFORE_SWEEP,
      SWEEP_PDH,
      ...Array<Row>(7).fill(FLAT), // c7..c13
      BODY_CLOSE_BELOW, // c14 closes 01:45 = expiresAt
    ]);
    expect(steps.map((s) => [s.index, s.events.map((e) => e.type)])).toEqual([
      [6, ["SWEEP"]],
      [14, ["CONFIRM"]],
    ]);
  });

  it("5. price pushes further before confirming → EXTEND, and the stop uses the new extreme", () => {
    const { steps } = runEur([
      ...BEFORE_SWEEP,
      SWEEP_PDH,
      [1.106, 1.109, 1.1058, 1.1065], // pushes to 1.10900
      [1.1064, 1.1066, 1.1005, 1.101], // confirms
    ]);
    expect(steps.map((s) => s.events)).toEqual([
      [sellSweep],
      [{ type: "EXTEND", dedupeKey: SELL_KEY, sweepExtreme: 1.109 }],
      [
        {
          type: "CONFIRM",
          dedupeKey: SELL_KEY,
          confirmTime: "2026-11-04T00:00:00.000Z",
          ticket: {
            entry: 1.101,
            stop: 1.1093, // 1.10900 + 3 pips
            target: 1.0761, // 83 × 3 = 249 pips
            stopPips: 83,
            targetPips: 249,
            riskPct: 0.5,
            riskUsd: 50,
            lotSize: 0.06, // $50 ÷ $830 = 0.0602
          },
        },
      ],
    ]);
  });

  it("6. USD_JPY uptrend, equal lows swept → BUY with JPY pips and lot size", () => {
    const rows: Row[] = [
      [157.05, 157.1, 157.0, 157.02],
      [157.02, 157.05, 156.95, 157.0],
      [157.0, 157.0, 156.9, 156.95], // swing low 156.900
      [157.0, 157.1, 156.98, 157.05],
      [157.05, 157.2, 157.05, 157.15], // swing high 157.200 (BOS level)
      [157.15, 157.15, 157.0, 157.05],
      [157.05, 157.05, 156.95, 157.0],
      [157.0, 157.0, 156.915, 156.95], // swing low 156.915 → equal lows, EQL 156.900
      [156.97, 157.08, 156.97, 157.05],
      [157.05, 157.1, 157.0, 157.05],
      [157.0, 157.05, 156.88, 156.95], // sweeps EQL
      [156.96, 157.3, 156.95, 157.25], // body close above 157.200
    ];
    const { steps } = replay(dgV1, {
      pair: "USD_JPY",
      D: daily(JPY_UP, JPY_HALF_RANGE, 3), // PDL 156.300 stays untouched
      H4: h4(JPY_UP, JPY_HALF_RANGE, 3),
      M15: m15(M15_START, rows),
    });
    const sweepTime = "2026-11-04T00:30:00.000Z";
    const key = `USD_JPY:BUY:${sweepTime}`;

    expect(steps.map((s) => s.events)).toEqual([
      [
        {
          type: "SWEEP",
          pair: "USD_JPY",
          dedupeKey: key,
          direction: "BUY",
          sweepType: "EQL",
          sweepLevel: 156.9,
          sweepExtreme: 156.88,
          sweepTime,
          bosLevel: 157.2,
          expiresAt: "2026-11-04T02:45:00.000Z",
        },
      ],
      [
        {
          type: "CONFIRM",
          dedupeKey: key,
          confirmTime: "2026-11-04T00:45:00.000Z",
          ticket: {
            entry: 157.25,
            stop: 156.85, // 156.880 − 3 pips (0.03)
            target: 158.45, // 40 × 3 = 120 pips above
            stopPips: 40,
            targetPips: 120,
            riskPct: 0.5,
            riskUsd: 50,
            lotSize: 0.19, // $50 ÷ (40 × 1000/157.25 = $254.37) = 0.1966
          },
        },
      ],
    ]);
  });

  it("8. a tiny account gives a lot below 0.01 → SKIP_INVALID instead of CONFIRM", () => {
    const { steps, openSetups } = runEur([...BEFORE_SWEEP, SWEEP_PDH, BODY_CLOSE_BELOW], {
      settings: { ...SETTINGS, accountSizeUsd: 100 },
    });
    expect(steps[1]?.events).toEqual([
      {
        type: "SKIP_INVALID",
        dedupeKey: SELL_KEY,
        reason: "Lot size below 0.01: $0.5 risk over a 71-pip stop",
      },
    ]);
    expect(openSetups).toEqual([]);
  });

  it("9. same input twice → identical output, and the input is not mutated", () => {
    const input = {
      pair: "EUR_USD" as const,
      now: new Date("2026-11-04T00:00:00.000Z"),
      candles: {
        D: D_DOWN,
        H4: H4_DOWN,
        M15: m15(M15_START, [...BEFORE_SWEEP, SWEEP_PDH, BODY_CLOSE_BELOW]),
      },
      settings: SETTINGS,
      openSetups: [
        {
          dedupeKey: SELL_KEY,
          direction: "SELL" as const,
          sweepType: "PDH" as const,
          sweepLevel: 1.107,
          sweepExtreme: 1.1078,
          sweepTime: SWEEP_TIME,
          bosLevel: 1.1015,
          expiresAt: "2026-11-04T01:45:00.000Z",
        },
      ],
    };
    const snapshot = structuredClone(input);
    const first = dgV1.evaluate(input);
    const second = dgV1.evaluate(input);
    expect(first).toEqual(second);
    expect(first.map((e) => e.type)).toEqual(["CONFIRM"]);
    expect(input).toEqual(snapshot);
  });
});

describe("dg-v1 guards", () => {
  it("re-evaluating the sweep candle with its setup already open emits nothing", () => {
    const candles = m15(M15_START, [...BEFORE_SWEEP, SWEEP_PDH]);
    const base = {
      pair: "EUR_USD" as const,
      now: new Date("2026-11-03T23:45:00.000Z"),
      candles: { D: D_DOWN, H4: H4_DOWN, M15: candles },
      settings: SETTINGS,
    };
    const events = dgV1.evaluate({ ...base, openSetups: [] });
    expect(events.map((e) => e.type)).toEqual(["SWEEP"]);
    expect(dgV1.evaluate({ ...base, openSetups: applyEvents([], events) })).toEqual([]);
  });

  it("ignores a candle that has not closed by `now`", () => {
    const candles = m15(M15_START, [...BEFORE_SWEEP, SWEEP_PDH]);
    const events = dgV1.evaluate({
      pair: "EUR_USD",
      now: new Date("2026-11-03T23:40:00.000Z"), // sweep candle still forming
      candles: { D: D_DOWN, H4: H4_DOWN, M15: candles },
      settings: SETTINGS,
      openSetups: [],
    });
    expect(events).toEqual([]);
  });

  it("does not re-sweep a PDH that was already traded through earlier in the day", () => {
    const { events } = runEur([
      ...BEFORE_SWEEP,
      SWEEP_PDH,
      ...Array<Row>(9).fill(FLAT), // expires
      [1.106, 1.108, 1.105, 1.1065], // above PDH again, but no longer fresh
    ]);
    expect(events.map((e) => e.type)).toEqual(["SWEEP", "EXPIRE"]);
  });

  it("returns no events without M15 candles", () => {
    expect(
      dgV1.evaluate({
        pair: "EUR_USD",
        now: new Date("2026-11-04T00:00:00.000Z"),
        candles: { D: D_DOWN, H4: H4_DOWN, M15: [] },
        settings: SETTINGS,
        openSetups: [],
      }),
    ).toEqual([]);
  });
});
