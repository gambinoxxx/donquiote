import { describe, expect, it } from "vitest";
import { planPaperBackfill, summarizePaper, type BackfillAlert, type PaperRow } from "./paper";

const ready: BackfillAlert = {
  id: "a1",
  status: "READY",
  paperStatus: null,
  readyAt: "2026-11-04T10:15:00.000Z",
  entry: 1.1,
  stop: 1.102,
  target: 1.094,
  stopPips: 20,
  targetPips: 60,
  lotSize: 0.25,
  riskPct: 0.5,
  riskUsd: 50,
};

describe("planPaperBackfill", () => {
  it("opens a trade for a READY alert with a valid ticket, at readyAt", () => {
    expect(planPaperBackfill([ready])).toEqual([{ alertId: "a1", paperOpenedAt: "2026-11-04T10:15:00.000Z" }]);
  });

  it("also covers alerts DG already marked Taken or Skipped (they passed READY)", () => {
    expect(planPaperBackfill([{ ...ready, status: "TAKEN" }, { ...ready, id: "a2", status: "SKIPPED" }])).toHaveLength(2);
  });

  it("skips alerts that never became READY, have no valid ticket, or already have a paper trade", () => {
    expect(
      planPaperBackfill([
        { ...ready, status: "WATCHING" },
        { ...ready, status: "EXPIRED" },
        { ...ready, readyAt: null },
        { ...ready, lotSize: 0 },
        { ...ready, entry: null },
        { ...ready, stop: ready.entry },
        { ...ready, paperStatus: "OPEN" },
        { ...ready, paperStatus: "WIN" },
      ]),
    ).toEqual([]);
  });

  it("is idempotent: once the opens are saved, a second run finds nothing", () => {
    const alerts = [ready, { ...ready, id: "a2" }];
    const first = planPaperBackfill(alerts);
    const opened = new Set(first.map((o) => o.alertId));
    const after = alerts.map((a) => (opened.has(a.id) ? { ...a, paperStatus: "OPEN" as const } : a));
    expect(first).toHaveLength(2);
    expect(planPaperBackfill(after)).toEqual([]);
  });
});

describe("summarizePaper", () => {
  const row = (strategyId: string, paperStatus: PaperRow["paperStatus"], day: number, r: number | null): PaperRow => ({
    strategyId,
    paperStatus,
    paperClosedAt: paperStatus === "OPEN" ? null : `2026-11-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    paperResultR: r,
    paperPnlUsd: r === null ? null : r * 50,
  });

  it("counts per strategy, keeps Unresolved out of the win rate, and finds the worst losing streak", () => {
    const [dg] = summarizePaper([
      row("dg-v1", "LOSS", 2, -1),
      row("dg-v1", "WIN", 1, 3),
      row("dg-v1", "LOSS", 3, -1),
      row("dg-v1", "UNRESOLVED", 4, 0.5),
      row("dg-v1", "LOSS", 5, -1),
      row("dg-v1", "OPEN", 0, null),
    ]);
    expect(dg).toEqual({
      strategyId: "dg-v1",
      trades: 6,
      open: 1,
      wins: 1,
      losses: 3,
      unresolved: 1,
      winRate: 0.25,
      netR: 0.5,
      netUsd: 25,
      worstLosingStreak: 2, // 2 Nov + 3 Nov; the Unresolved on 4 Nov ends it
    });
  });

  it("separates strategies and gives a null win rate with no decided trades", () => {
    const out = summarizePaper([row("b", "OPEN", 0, null), row("a", "UNRESOLVED", 1, -0.4)]);
    expect(out.map((s) => s.strategyId)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({ winRate: null, unresolved: 1, netR: -0.4 });
    expect(out[1]).toMatchObject({ winRate: null, open: 1, netR: 0 });
  });
});
