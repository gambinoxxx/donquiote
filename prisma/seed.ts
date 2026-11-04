// Idempotent seed: safe to run any number of times.
// Creates the default Settings row, the watchlist and the heartbeat row.
// No sample alerts, journal entries or candles.
import "dotenv/config";
import { getDb } from "../lib/db/client";
import { SETTINGS_ID } from "../lib/db/settings";
import type { Pair } from "../lib/db/generated/client";

const WATCHLIST: ReadonlyArray<{ pair: Pair; enabled: boolean }> = [
  { pair: "EUR_USD", enabled: true },
  { pair: "GBP_USD", enabled: true },
  { pair: "USD_JPY", enabled: true },
  { pair: "USD_CAD", enabled: true },
  { pair: "USD_CHF", enabled: true },
  { pair: "XAU_USD", enabled: false },
];

const HEARTBEAT_ID = 1;

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

  const [settings, pairs, heartbeats] = await Promise.all([
    db.settings.count(),
    db.watchlistPair.count(),
    db.workerHeartbeat.count(),
  ]);
  console.log(
    JSON.stringify({ step: "seed", outcome: "ok", settings, pairs, heartbeats }),
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
