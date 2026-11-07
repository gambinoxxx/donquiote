import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "@/lib/settings/__fixtures__/defaults";
import { NO_CHANGES_MESSAGE, restoreTarget, saveSnapshot, STALE_MESSAGE, type SettingsDb, type SettingsTx } from "./settings-store";

// --- A fake database with real transactions (all or nothing) ---------------

interface State {
  settings: Record<string, unknown>;
  pairs: Array<{ pair: string; enabled: boolean; sortOrder: number }>;
  modes: Array<{ strategyId: string; mode: string }>;
  versions: Array<{ id: string; createdAt: number; createdBy: string; snapshot: unknown; changes: unknown; restoredFromId: string | null }>;
}

function fakeDb(options: { failVersionInsert?: boolean } = {}) {
  let state: State = {
    settings: { id: 1, ...DEFAULTS },
    pairs: [
      { pair: "EUR_USD", enabled: true, sortOrder: 1 },
      { pair: "GBP_USD", enabled: true, sortOrder: 2 },
      { pair: "XAU_USD", enabled: false, sortOrder: 6 },
    ],
    modes: [
      { strategyId: "dg-v1", mode: "LIVE" },
      { strategyId: "gemini-fvg", mode: "TEST" },
    ],
    versions: [{ id: "v0", createdAt: 0, createdBy: "system", snapshot: {}, changes: [], restoredFromId: null }],
  };
  let n = 0;
  let clock = 1;
  const txFor = (s: State): SettingsTx => ({
    $queryRaw: vi.fn(async () => [{}]),
    settings: {
      findUniqueOrThrow: async () => ({ ...s.settings }),
      update: async ({ data }) => Object.assign(s.settings, data),
    },
    watchlistPair: {
      findMany: async () => s.pairs.map((p) => ({ ...p })),
      update: async ({ where, data }) => Object.assign(s.pairs.find((p) => p.pair === where.pair) as object, data),
    },
    strategyConfig: {
      findMany: async () => s.modes.map((m) => ({ ...m })),
      update: async ({ where, data }) => Object.assign(s.modes.find((m) => m.strategyId === where.strategyId) as object, data),
    },
    settingsVersion: {
      findFirst: async () => {
        const latest = [...s.versions].sort((a, b) => b.createdAt - a.createdAt)[0];
        return latest ? { id: latest.id } : null;
      },
      create: async ({ data }) => {
        if (options.failVersionInsert) throw new Error("insert failed");
        const v = { id: `v${++n}`, createdAt: clock++, restoredFromId: null, ...data } as State["versions"][number];
        s.versions.push(v);
        return { id: v.id };
      },
    },
  });
  const db: SettingsDb = {
    async $transaction(fn) {
      const draft: State = structuredClone(state);
      const result = await fn(txFor(draft as State) as never);
      state = draft; // commit only if fn finished
      return result;
    },
  };
  return { db, state: () => state };
}

const latest = (s: State) => [...s.versions].sort((a, b) => b.createdAt - a.createdAt)[0] as State["versions"][number];

describe("saveSnapshot (saveSettings' transaction)", () => {
  it("writes the settings and a version with the diff, together", async () => {
    const f = fakeDb();
    const r = await saveSnapshot(f.db, {
      email: "dg@example.com",
      baseVersionId: "v0",
      build: (c) => ({ ...c, settings: { ...c.settings, riskPct: 1 } }),
    });
    expect(r).toEqual({ ok: true, versionId: "v1", changes: [{ field: "Risk per trade", from: "0.5%", to: "1%" }] });
    expect(f.state().settings.riskPct).toBe(1);
    expect(latest(f.state())).toMatchObject({ id: "v1", createdBy: "dg@example.com", changes: [{ field: "Risk per trade" }] });
  });

  it("if the version insert fails, nothing changes", async () => {
    const f = fakeDb({ failVersionInsert: true });
    await expect(
      saveSnapshot(f.db, { email: "dg@example.com", baseVersionId: "v0", build: (c) => ({ ...c, settings: { ...c.settings, riskPct: 1 } }) }),
    ).rejects.toThrow("insert failed");
    expect(f.state().settings.riskPct).toBe(0.5);
    expect(f.state().versions).toHaveLength(1);
  });

  it("refuses a stale base version (another device saved first) and writes nothing", async () => {
    const f = fakeDb();
    const first = await saveSnapshot(f.db, { email: "a@x.com", baseVersionId: "v0", build: (c) => ({ ...c, settings: { ...c.settings, riskPct: 1 } }) });
    expect(first.ok).toBe(true);
    const second = await saveSnapshot(f.db, { email: "b@x.com", baseVersionId: "v0", build: (c) => ({ ...c, settings: { ...c.settings, maxTradesPerDay: 3 } }) });
    expect(second).toEqual({ ok: false, stale: true, error: STALE_MESSAGE });
    expect(f.state().settings.maxTradesPerDay).toBe(2);
    expect(f.state().versions).toHaveLength(2);
  });

  it("no changes → no version written", async () => {
    const f = fakeDb();
    const r = await saveSnapshot(f.db, { email: "dg@example.com", baseVersionId: "v0", build: (c) => c });
    expect(r).toEqual({ ok: true, noChanges: true, versionId: "v0" });
    expect(f.state().versions).toHaveLength(1);
    expect(NO_CHANGES_MESSAGE).toBe("No changes");
  });

  it("invalid values are refused with field errors and nothing is written", async () => {
    const f = fakeDb();
    const r = await saveSnapshot(f.db, { email: "dg@example.com", baseVersionId: "v0", build: (c) => ({ ...c, settings: { ...c.settings, riskPct: 5 } }) });
    expect(r).toMatchObject({ ok: false, fieldErrors: [{ path: "settings.riskPct" }] });
    expect(f.state().settings.riskPct).toBe(0.5);
  });

  it("can't add pairs or strategies through a save", async () => {
    const f = fakeDb();
    const r = await saveSnapshot(f.db, {
      email: "dg@example.com",
      baseVersionId: "v0",
      build: (c) => ({ ...c, strategies: [...c.strategies, { strategyId: "made-up", mode: "LIVE" }] }),
    });
    expect(r.ok).toBe(false);
  });
});

describe("modes", () => {
  const setMode = (id: string, mode: string) => (c: Parameters<Parameters<typeof saveSnapshot>[1]["build"]>[0]) => ({
    ...c,
    strategies: c.strategies.map((s) => (s.strategyId === id ? { ...s, mode } : s)),
  });

  it("the last LIVE strategy can't be turned off or set to Test", async () => {
    const f = fakeDb();
    for (const mode of ["OFF", "TEST"]) {
      const r = await saveSnapshot(f.db, { email: "dg@example.com", baseVersionId: "v0", build: setMode("dg-v1", mode) });
      expect(r).toMatchObject({ ok: false, error: "At least one strategy must stay Live." });
    }
    expect(f.state().modes.find((m) => m.strategyId === "dg-v1")?.mode).toBe("LIVE");
  });

  it("several LIVE strategies are allowed; then one of them can go back to Test", async () => {
    const f = fakeDb();
    const a = await saveSnapshot(f.db, { email: "dg@example.com", baseVersionId: "v0", build: setMode("gemini-fvg", "LIVE"), strategyName: () => "FVG Retest" });
    expect(a).toMatchObject({ ok: true, changes: [{ field: "FVG Retest", from: "Test", to: "Live" }] });
    const b = await saveSnapshot(f.db, { email: "dg@example.com", baseVersionId: a.ok && "versionId" in a ? a.versionId : null, build: setMode("dg-v1", "TEST") });
    expect(b.ok).toBe(true);
    expect(f.state().modes).toEqual([
      { strategyId: "dg-v1", mode: "TEST" },
      { strategyId: "gemini-fvg", mode: "LIVE" },
    ]);
  });
});

describe("restore", () => {
  it("brings the old values back as a new version with restoredFromId", async () => {
    const f = fakeDb();
    const v1 = await saveSnapshot(f.db, {
      email: "dg@example.com",
      baseVersionId: "v0",
      build: (c) => ({ ...c, settings: { ...c.settings, paperTimeoutHours: 48 }, watchlist: c.watchlist.map((w) => (w.pair === "XAU_USD" ? { ...w, enabled: true } : w)) }),
    });
    expect(v1.ok).toBe(true);
    const old = structuredClone(f.state().versions[0]) as State["versions"][number];
    // v0's snapshot is the defaults (taken before v1).
    const before = { settings: { ...DEFAULTS }, watchlist: f.state().pairs.map((p) => ({ ...p, enabled: p.pair !== "XAU_USD" })), strategies: f.state().modes };
    const r = await saveSnapshot(f.db, {
      email: "g@example.com",
      baseVersionId: "v1",
      build: (c) => restoreTarget(c, before as never),
      restoredFromId: old.id,
    });
    expect(r).toMatchObject({ ok: true, versionId: "v2" });
    expect(f.state().settings.paperTimeoutHours).toBe(72);
    expect(f.state().pairs.find((p) => p.pair === "XAU_USD")?.enabled).toBe(false);
    expect(latest(f.state())).toMatchObject({ id: "v2", restoredFromId: "v0", createdBy: "g@example.com" });
    expect((latest(f.state()).changes as Array<{ field: string }>).map((c) => c.field)).toEqual(["Paper trade time limit", "Gold (XAU/USD)"]);
  });

  it("restoreTarget keeps pairs and strategies added after the old version", () => {
    const current = {
      settings: { ...DEFAULTS, riskPct: 1 },
      watchlist: [
        { pair: "EUR_USD" as const, enabled: false, sortOrder: 1 },
        { pair: "USD_CHF" as const, enabled: true, sortOrder: 5 },
      ],
      strategies: [
        { strategyId: "dg-v1", mode: "LIVE" as const },
        { strategyId: "pro-v1-swing", mode: "TEST" as const },
      ],
    };
    const old = { settings: DEFAULTS, watchlist: [{ pair: "EUR_USD" as const, enabled: true, sortOrder: 1 }], strategies: [{ strategyId: "dg-v1", mode: "LIVE" as const }] };
    expect(restoreTarget(current, old)).toEqual({
      settings: DEFAULTS,
      watchlist: [
        { pair: "EUR_USD", enabled: true, sortOrder: 1 },
        { pair: "USD_CHF", enabled: true, sortOrder: 5 },
      ],
      strategies: [
        { strategyId: "dg-v1", mode: "LIVE" },
        { strategyId: "pro-v1-swing", mode: "TEST" },
      ],
    });
  });
});

describe("invariant 13: one write path", () => {
  it("only lib/data/settings-store.ts (and the seed) write Settings, WatchlistPair, StrategyConfig or SettingsVersion", () => {
    const root = path.resolve(__dirname, "../..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (["node_modules", ".next", "generated", ".git", "doc"].includes(name)) continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
      }
    };
    for (const d of ["app", "components", "lib", "worker", "scripts", "prisma"]) walk(path.join(root, d));
    const writers = files.filter((f) =>
      /\b(settings|watchlistPair|strategyConfig|settingsVersion)\.(update|upsert|create|delete|createMany|updateMany|deleteMany)\b/.test(readFileSync(f, "utf8")),
    );
    expect(writers.map((f) => path.relative(root, f)).sort()).toEqual(["lib/data/settings-store.ts", "prisma/seed.ts"]);
  });
});
