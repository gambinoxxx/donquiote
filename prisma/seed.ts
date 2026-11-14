// Idempotent seed: safe to run any number of times.
// Creates the default Settings row, the watchlist and the heartbeat row.
// No sample alerts, journal entries or candles.
import "dotenv/config";
import { getDb } from "../lib/db/client";
import { SETTINGS_ID } from "../lib/db/settings";
import type { Pair, StrategyMode } from "../lib/db/generated/client";
import { loadSnapshot, type SettingsTx } from "../lib/data/settings-store";

const WATCHLIST: ReadonlyArray<{ pair: Pair; enabled: boolean }> = [
  { pair: "EUR_USD", enabled: true },
  { pair: "GBP_USD", enabled: true },
  { pair: "USD_JPY", enabled: true },
  { pair: "USD_CAD", enabled: true },
  { pair: "USD_CHF", enabled: true },
  { pair: "XAU_USD", enabled: false },
];

const HEARTBEAT_ID = 1;

// dg-v1 notifies (LIVE); the others record silently (TEST). At least one
// strategy must be LIVE; several are allowed (architecture invariant 10).
const STRATEGY_MODES: ReadonlyArray<{ strategyId: string; mode: StrategyMode }> = [
  { strategyId: "dg-v1", mode: "LIVE" },
  { strategyId: "dg-v2-candidate", mode: "TEST" },
  { strategyId: "gemini-fvg", mode: "TEST" },
  { strategyId: "pro-v1-swing", mode: "TEST" },
  { strategyId: "gemini-fvg-2r", mode: "TEST" },
  { strategyId: "london-break", mode: "TEST" },
];

async function main(): Promise<void> {
  const db = getDb();

  // Defaults come from the schema; existing settings are left untouched.
  await db.settings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });

  // Only create missing pairs, so a re-seed never overrides DG's on/off choices.
  for (const [index, { pair, enabled }] of WATCHLIST.entries()) {
    await db.watchlistPair.upsert({
      where: { pair },
      create: { pair, enabled, sortOrder: index + 1 },
      update: {},
    });
  }

  await db.workerHeartbeat.upsert({
    where: { id: HEARTBEAT_ID },
    create: { id: HEARTBEAT_ID },
    update: {},
  });

  // Create-only: never overwrite a mode changed later.
  for (const { strategyId, mode } of STRATEGY_MODES) {
    await db.strategyConfig.upsert({
      where: { strategyId },
      create: { strategyId, mode },
      update: {},
    });
  }

  // Settings history: one first version with the current values, if none yet
  // (every later change goes through saveSettings).
  if ((await db.settingsVersion.count()) === 0) {
    const first = await loadSnapshot(db as unknown as SettingsTx);
    await db.settingsVersion.create({ data: { createdBy: "system", snapshot: first as never, changes: [] } });
  }

  const [settings, pairs, heartbeats, strategies, versions] = await Promise.all([
    db.settings.count(),
    db.watchlistPair.count(),
    db.workerHeartbeat.count(),
    db.strategyConfig.findMany({ orderBy: { strategyId: "asc" } }),
    db.settingsVersion.count(),
  ]);
  console.log(
    JSON.stringify({
      step: "seed",
      outcome: "ok",
      settings,
      pairs,
      heartbeats,
      strategies: strategies.map((s) => `${s.strategyId}=${s.mode}`),
      settingsVersions: versions,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        step: "seed",
        outcome: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
