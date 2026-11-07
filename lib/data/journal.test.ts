// Journal (Unit 14): actions, the risk guard read, comparison totals and CSV,
// against an in-memory fake of the Prisma client.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csvField, strategyComparison, toCsv } from "./journal-logic";
import { suggestLots } from "@/lib/risk/lots";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireAllowedUser = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAllowedUser: () => requireAllowedUser() }));

type Row = Record<string, unknown> & { id: string };
let entries: Row[] = [];
let paper: Row[] = [];
let alertReads = 0;

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => (v === null ? row[k] === null || row[k] === undefined : row[k] === v));

const db = {
  settings: {
    findUniqueOrThrow: vi.fn(async () => ({
      accountSizeUsd: 10_000,
      riskPct: 0.5,
      dailyLossLimitPct: 5,
      maxDrawdownPct: 10,
      warnDailyLossPct: 2,
      stopDailyLossPct: 3,
      warnOverallLossPct: 6,
      maxTradesPerDay: 3,
      dayResetTz: "America/New_York",
      dayResetHour: 17,
      drawdownType: "STATIC",
    })),
  },
  strategyConfig: { findMany: vi.fn(async () => [{ strategyId: "dg-v1", mode: "LIVE" }]) },
  alert: {
    findMany: vi.fn(async () => {
      alertReads++;
      return paper.map((p) => ({ ...p, journal: null }));
    }),
  },
  journalEntry: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => entries.find((e) => matches(e, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => entries.filter((e) => matches(e, where))),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = entries.filter((e) => matches(e, where));
      hit.forEach((e) => Object.assign(e, data));
      return { count: hit.length };
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `j${entries.length + 1}`, result: null, resultR: null, pnlUsd: null, closedAt: null, deletedAt: null, ...data };
      entries.push(row as Row);
      return { id: row.id };
    }),
  },
};
vi.mock("@/lib/db/client", () => ({ getDb: () => db }));

const actions = await import("./journal-actions");
const { exportCsv, getRiskGuard } = await import("./journal");

const trade = { pair: "EUR_USD", direction: "SELL", entry: 1.1, stop: 1.102, target: 1.094, lots: 0.25, riskUsd: 50 };

beforeEach(() => {
  entries = [];
  paper = [];
  alertReads = 0;
  vi.clearAllMocks();
  requireAllowedUser.mockResolvedValue({ email: "dg@example.com" });
});

describe("journal actions", () => {
  it("refuses a user who is not allowed, before touching the database", async () => {
    requireAllowedUser.mockRejectedValue(new Error("This email is not allowed to use the app"));
    await expect(actions.addManualTrade(trade)).rejects.toThrow("not allowed");
    await expect(actions.logResult("j1", { result: "WIN" })).rejects.toThrow();
    await expect(actions.editEntry("j1", { trade })).rejects.toThrow();
    await expect(actions.deleteEntry("j1")).rejects.toThrow();
    expect(db.journalEntry.create).not.toHaveBeenCalled();
    expect(db.journalEntry.updateMany).not.toHaveBeenCalled();
  });

  it("validates a manual trade (stop on the wrong side)", async () => {
    const r = await actions.addManualTrade({ ...trade, stop: 1.09 });
    expect(r.ok).toBe(false);
    expect(entries).toHaveLength(0);
  });

  it("logs a result once; a closed entry can be edited but not logged twice", async () => {
    await actions.addManualTrade(trade);
    expect(await actions.logResult("j1", { result: "WIN" })).toEqual({ ok: true });
    expect(entries[0]).toMatchObject({ status: "CLOSED", result: "WIN", pnlUsd: 150, resultR: 3 });

    const again = await actions.logResult("j1", { result: "LOSS" });
    expect(again).toEqual({ ok: false, error: "This trade already has a result. Edit it to change it." });
    expect(entries[0]).toMatchObject({ result: "WIN", pnlUsd: 150 });

    expect(await actions.editEntry("j1", { trade, result: { result: "CUSTOM", usd: -42.5 } })).toEqual({ ok: true });
    expect(entries[0]).toMatchObject({ result: "CUSTOM", pnlUsd: -42.5, resultR: -0.85 });
  });

  it("result money: win = risk × R, loss = −risk, BE = 0, custom = USD", async () => {
    for (let i = 0; i < 4; i++) await actions.addManualTrade(trade);
    await actions.logResult("j1", { result: "WIN", r: 2.5 });
    await actions.logResult("j2", { result: "LOSS" });
    await actions.logResult("j3", { result: "BREAKEVEN" });
    expect((await actions.logResult("j4", { result: "CUSTOM" })).ok).toBe(false);
    await actions.logResult("j4", { result: "CUSTOM", usd: 12 });
    expect(entries.map((e) => e.pnlUsd)).toEqual([125, -50, 0, 12]);
  });

  it("soft delete removes the trade from the risk guard", async () => {
    await actions.addManualTrade(trade);
    await actions.logResult("j1", { result: "LOSS" });
    expect((await getRiskGuard()).todayPnlUsd).toBe(-50);

    expect(await actions.deleteEntry("j1")).toEqual({ ok: true });
    expect(entries[0]!.deletedAt).toBeInstanceOf(Date);
    const g = await getRiskGuard();
    expect(g.todayPnlUsd).toBe(0);
    expect(g.tradesToday).toBe(0);
    // Deleted entries can't be edited, logged or deleted again.
    expect((await actions.logResult("j1", { result: "WIN" })).ok).toBe(false);
    expect((await actions.editEntry("j1", { trade })).ok).toBe(false);
    expect((await actions.deleteEntry("j1")).ok).toBe(false);
  });
});

describe("risk guard isolation", () => {
  it("paper trades never change the guard (alerts are never read)", async () => {
    await actions.addManualTrade(trade);
    const before = await getRiskGuard();
    paper = [
      { id: "a1", strategyId: "dg-v1", paperStatus: "LOSS", paperPnlUsd: -5000, paperResultR: -1, paperClosedAt: new Date() },
    ];
    const after = await getRiskGuard();
    expect(after).toEqual(before);
    expect(alertReads).toBe(0);
    expect(db.alert.findMany).not.toHaveBeenCalled();
  });
});

describe("strategy comparison", () => {
  it("totals equal the sum of the strategies", () => {
    const t = (strategyId: string, paperStatus: string, r: number | null) => ({
      strategyId,
      paperStatus: paperStatus as "WIN",
      paperClosedAt: paperStatus === "OPEN" ? null : "2026-11-02T10:00:00.000Z",
      paperResultR: r,
      paperPnlUsd: r === null ? null : r * 50,
    });
    const rows = [
      t("a", "WIN", 3),
      t("a", "LOSS", -1),
      t("a", "LOSS", -1),
      t("b", "WIN", 3),
      t("b", "UNRESOLVED", 0.4),
      t("b", "NOT_FILLED", null),
      t("c", "OPEN", null),
      t("c", "LOSS", -1),
    ];
    const { rows: out, totals } = strategyComparison(["a", "b", "c", "d"], rows);
    expect(out).toHaveLength(4);
    for (const k of ["closed", "wins", "losses", "unresolved", "notFilled", "open", "netR", "netUsd"] as const) {
      expect(totals[k]).toBeCloseTo(out.reduce((s, r) => s + r[k], 0), 6);
    }
    expect(totals.netR).toBeCloseTo(3.4, 6);
    expect(out.find((r) => r.strategyId === "d")).toMatchObject({ closed: 0, early: true, winRate: null });
  });
});

describe("CSV", () => {
  it("escapes commas, quotes, line breaks and formula-like text", () => {
    expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvField("a\nb")).toBe('"a\nb"');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField(-50)).toBe("-50");
    expect(csvField(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });

  it("exports my trades with the expected columns", async () => {
    await actions.addManualTrade({ ...trade, note: 'news, "NFP"' });
    await actions.logResult("j1", { result: "LOSS" });
    const { filename, csv } = await exportCsv("trades", "7d");
    const [header, row] = csv.trimEnd().split("\r\n");
    expect(filename).toMatch(/^donquixote-my-trades-7d-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(header).toBe(
      "opened_at_utc,pair,direction,strategy,entry,stop,target,lots,risk_usd,status,result,result_r,pnl_usd,closed_at_utc,note",
    );
    expect(row).toContain(",EUR_USD,SELL,manual,1.1,1.102,1.094,0.25,50,CLOSED,LOSS,-1,-50,");
    expect(row!.endsWith(',"news, ""NFP"""')).toBe(true);
  });
});

describe("suggestLots", () => {
  it("sizes from the stop distance and risk, rounded down", () => {
    expect(suggestLots("EUR_USD", 1.1, 1.102, 50)).toBe(0.25);
    expect(suggestLots("EUR_USD", 1.1, 1.1, 50)).toBeNull();
    expect(suggestLots("EUR_USD", 1.1, 1.2, 1)).toBeNull();
  });
});
