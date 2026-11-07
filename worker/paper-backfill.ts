// npm run paper:backfill
// Opens paper trades for alerts that reached READY before Unit 8: every
// READY (or later Taken/Skipped) alert with a valid ticket and no
// paperStatus gets paperStatus = OPEN and paperOpenedAt = readyAt. The next
// worker cycle resolves them from the stored candles. Running it twice
// changes nothing (each write is guarded by paperStatus IS NULL).
import "./load-env";
import { getDb } from "@/lib/db/client";
import { lagos } from "./format";
import { planPaperBackfill } from "./paper";

async function main(): Promise<number> {
  const db = getDb();
  const rows = await db.alert.findMany({
    where: { status: { in: ["READY", "TAKEN", "SKIPPED"] }, paperStatus: null },
    orderBy: { readyAt: "asc" },
  });
  const opens = planPaperBackfill(
    rows.map((a) => ({ ...a, readyAt: a.readyAt ? a.readyAt.toISOString() : null })),
  );
  const byId = new Map(rows.map((a) => [a.id, a]));

  let opened = 0;
  for (const open of opens) {
    const { count } = await db.alert.updateMany({
      where: { id: open.alertId, paperStatus: null },
      data: { paperStatus: "OPEN", paperOpenedAt: new Date(open.paperOpenedAt) },
    });
    opened += count;
    const a = byId.get(open.alertId);
    if (count === 1 && a) {
      console.log(
        `  opened  ${a.strategyId}  ${a.pair} ${a.direction}  entry ${a.entry} stop ${a.stop} target ${a.target}  ` +
          `${a.lotSize} lots, $${a.riskUsd} risk  · from ${lagos(open.paperOpenedAt)} Lagos`,
      );
    }
  }

  const skipped = rows.length - opens.length;
  const [openTotal, readyTotal] = await Promise.all([
    db.alert.count({ where: { paperStatus: "OPEN" } }),
    db.alert.count({ where: { readyAt: { not: null } } }),
  ]);
  console.log(
    `\npaper:backfill · ${rows.length} Ready alerts without a paper trade · ${opened} opened · ` +
      `${skipped} skipped (no valid ticket)`,
  );
  console.log(`Now ${openTotal} OPEN paper trades; ${readyTotal} alerts have reached Ready in total.`);
  if (opened > 0) console.log("The next worker cycle resolves them (npm run worker:once).");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect().catch(() => {});
  });
