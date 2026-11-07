// lib/data with a mocked Prisma client and auth.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireAllowedUser = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAllowedUser: () => requireAllowedUser() }));

const db = {
  strategyConfig: { findMany: vi.fn() },
  alert: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  journalEntry: { create: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("@/lib/db/client", () => ({ getDb: () => db }));

const { getAlerts } = await import("./index");
const { loadAlerts, markSkipped, markTaken } = await import("./actions");
const { decideAlert } = await import("./decide");

function alertRow(i: number, strategyId = "dg-v1") {
  return {
    id: `a${i}`,
    strategyId,
    pair: "EUR_USD",
    direction: "SELL",
    status: "WATCHING",
    statusNote: null,
    dedupeKey: `k${i}`,
    sweepType: "PDH",
    sweepLevel: 1.107,
    sweepExtreme: 1.1078,
    sweepTime: new Date(Date.parse("2026-11-04T10:00:00Z") - i * 15 * 60_000),
    bosLevel: 1.1015,
    entry: null,
    stop: null,
    target: null,
    stopPips: null,
    targetPips: null,
    lotSize: null,
    riskPct: null,
    riskUsd: null,
    entryType: "MARKET",
    entryValidUntil: null,
    createdAt: new Date(),
    readyAt: null,
    expiresAt: new Date(),
    expiredAt: null,
    decidedAt: null,
    notifiedAt: null,
    notifyState: "NONE",
    notifyGroupId: null,
    paperStatus: null,
    paperOpenedAt: null,
    paperClosedAt: null,
    paperExitPrice: null,
    paperResultR: null,
    paperPnlUsd: null,
    paperNote: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAllowedUser.mockResolvedValue({ userId: "u", email: "dg@example.com" });
  db.strategyConfig.findMany.mockResolvedValue([
    { strategyId: "dg-v1", mode: "LIVE" },
    { strategyId: "gemini-fvg", mode: "TEST" },
  ]);
});

describe("getAlerts", () => {
  it("asks for 31 newest-first rows with the LIVE filter, returns 30 and a cursor", async () => {
    db.alert.findMany.mockResolvedValue(Array.from({ length: 31 }, (_, i) => alertRow(i)));
    const page = await getAlerts({ status: "all", includeTest: false });
    const args = db.alert.findMany.mock.calls[0]?.[0];
    expect(args).toMatchObject({
      where: { strategyId: { in: ["dg-v1"] } },
      orderBy: [{ sweepTime: "desc" }, { id: "desc" }],
      take: 31,
    });
    expect(args).not.toHaveProperty("cursor");
    expect(page.items).toHaveLength(30);
    expect(page.nextCursor).toBe("a29");
    expect(page.items[0]).toMatchObject({ id: "a0", pair: "EUR_USD", isTest: false, strategy: { code: "V1", mode: "LIVE" } });
  });

  it("passes the cursor (skipping it) for the next page; test signals are marked", async () => {
    db.alert.findMany.mockResolvedValue([alertRow(30, "gemini-fvg")]);
    const page = await getAlerts({ status: "watching", includeTest: true, cursor: "a29" });
    expect(db.alert.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { status: { in: ["WATCHING"] } }, cursor: { id: "a29" }, skip: 1 });
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({ isTest: true, strategy: { code: "FVG", mode: "TEST" } });
    // Plain data only: nothing from Prisma leaks through (dates are strings).
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
  });
});

describe("server actions refuse users who are not allowed", () => {
  it.each([
    ["loadAlerts", () => loadAlerts({ status: "all", includeTest: false })],
    ["markSkipped", () => markSkipped("a1")],
    ["markTaken", () => markTaken("a1")],
  ])("%s", async (_name, call) => {
    requireAllowedUser.mockRejectedValue(new Error("This email is not allowed to use the app"));
    await expect(call()).rejects.toThrow(/not allowed/);
    expect(db.alert.findMany).not.toHaveBeenCalled();
    expect(db.alert.updateMany).not.toHaveBeenCalled();
    expect(db.journalEntry.create).not.toHaveBeenCalled();
  });

  it("rejects bad input", async () => {
    await expect(loadAlerts({ status: "nonsense", includeTest: false })).rejects.toThrow();
    expect(await markSkipped("")).toEqual({ ok: false, error: "Invalid alert." });
  });
});

describe("Skip / Taken: status only moves forward", () => {
  const now = new Date("2026-11-04T10:05:00Z");
  function fakeDb(status: string) {
    let current = status;
    const tx = {
      alert: {
        updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
          if (current !== where.status) return { count: 0 };
          current = data.status;
          return { count: 1 };
        }),
      },
      journalEntry: { create: vi.fn(async () => ({})) },
    };
    return {
      tx,
      status: () => current,
      db: {
        alert: { findUnique: vi.fn(async () => ({ status: current, pair: "EUR_USD", direction: "SELL" })) },
        $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      },
    };
  }

  it("READY → SKIPPED, guarded by status = READY", async () => {
    const f = fakeDb("READY");
    expect(await decideAlert(f.db as never, "a1", "SKIPPED", now)).toEqual({ ok: true });
    expect(f.tx.alert.updateMany).toHaveBeenCalledWith({ where: { id: "a1", status: "READY" }, data: { status: "SKIPPED", decidedAt: now } });
    expect(f.tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it("READY → TAKEN creates a journal entry in the same transaction", async () => {
    const f = fakeDb("READY");
    expect(await decideAlert(f.db as never, "a1", "TAKEN", now)).toEqual({ ok: true });
    expect(f.tx.journalEntry.create).toHaveBeenCalledWith({ data: { alertId: "a1", pair: "EUR_USD", direction: "SELL", takenAt: now } });
    expect(f.status()).toBe("TAKEN");
  });

  it.each(["WATCHING", "EXPIRED", "TAKEN", "SKIPPED"])("from %s nothing changes and no journal entry", async (status) => {
    const f = fakeDb(status);
    const result = await decideAlert(f.db as never, "a1", "TAKEN", now);
    expect(result.ok).toBe(false);
    expect(f.status()).toBe(status);
    expect(f.tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it("a second decision after the first is refused (never backwards)", async () => {
    const f = fakeDb("READY");
    await decideAlert(f.db as never, "a1", "SKIPPED", now);
    expect(await decideAlert(f.db as never, "a1", "TAKEN", now)).toEqual({ ok: false, error: "This alert is already skipped." });
    expect(f.status()).toBe("SKIPPED");
  });

  it("unknown alert", async () => {
    const f = fakeDb("READY");
    f.db.alert.findUnique.mockResolvedValueOnce(null as never);
    expect(await decideAlert(f.db as never, "nope", "SKIPPED", now)).toEqual({ ok: false, error: "Alert not found." });
  });
});
