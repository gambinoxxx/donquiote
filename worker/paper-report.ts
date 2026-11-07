// npm run paper:report -- [--strategy dg-v1]
// Read-only. Per strategy: open / wins / losses / unresolved, win rate
// (Unresolved not counted), net R, net USD and worst losing streak.
import "./load-env";
import { parseArgs } from "node:util";
import { getDb } from "@/lib/db/client";
import { lagos } from "./format";
import { summarizePaper } from "./paper";

/** Results are "early" until this many decided paper trades (project-overview.md). */
const EARLY_UNTIL_TRADES = 30;

const signed = (n: number, digits = 2) => `${n < 0 ? "-" : "+"}${Math.abs(n).toFixed(digits)}`;

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { strategy: { type: "string" } } });
  const db = getDb();
  const rows = await db.alert.findMany({
    where: { paperStatus: { not: null }, ...(values.strategy && { strategyId: values.strategy }) },
    select: {
      strategyId: true,
      pair: true,
      direction: true,
      paperStatus: true,
      paperOpenedAt: true,
      paperClosedAt: true,
      paperResultR: true,
      paperPnlUsd: true,
      paperNote: true,
    },
    orderBy: { paperOpenedAt: "asc" },
  });

  const scope = values.strategy ? `strategy ${values.strategy}` : "all strategies";
  console.log(`Paper trades · ${scope} · ${rows.length} trades`);
  console.log("Entry at the alert price; no spread, commission or slippage, so real results will be a little worse.\n");
  if (rows.length === 0) {
    console.log("No paper trades yet.");
    return 0;
  }

  const summaries = summarizePaper(
    rows.map((r) => ({
      strategyId: r.strategyId,
      paperStatus: r.paperStatus as NonNullable<typeof r.paperStatus>,
      paperClosedAt: r.paperClosedAt ? r.paperClosedAt.toISOString() : null,
      paperResultR: r.paperResultR,
      paperPnlUsd: r.paperPnlUsd,
    })),
  );
  const header = ["Strategy", "Open", "Win", "Loss", "Unres.", "Win rate", "Net R", "Net $", "Worst streak"];
  const table = summaries.map((s) => {
    const decided = s.wins + s.losses + s.unresolved;
    return [
      s.strategyId + (decided < EARLY_UNTIL_TRADES ? ` (early: ${decided}/${EARLY_UNTIL_TRADES})` : ""),
      String(s.open),
      String(s.wins),
      String(s.losses),
      String(s.unresolved),
      s.winRate === null ? "—" : `${(s.winRate * 100).toFixed(1)}%`,
      `${signed(s.netR)}R`,
      `${s.netUsd < 0 ? "-" : "+"}$${Math.abs(s.netUsd).toFixed(2)}`,
      String(s.worstLosingStreak),
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...table.map((row) => (row[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join("  ");
  console.log(line(header));
  for (const row of table) console.log(line(row));
  console.log("\nWin rate = wins ÷ (wins + losses); Unresolved trades are counted separately (their R is in net R).");

  console.log("\nTrades (Lagos time):");
  for (const r of rows) {
    const result =
      r.paperStatus === "OPEN"
        ? "OPEN"
        : `${r.paperStatus} ${signed(r.paperResultR ?? 0)}R ${(r.paperPnlUsd ?? 0) < 0 ? "-" : "+"}$${Math.abs(r.paperPnlUsd ?? 0).toFixed(2)}` +
          ` · closed ${r.paperClosedAt ? lagos(r.paperClosedAt.toISOString()) : "?"}`;
    console.log(
      `  ${r.strategyId}  ${r.pair} ${r.direction}  opened ${r.paperOpenedAt ? lagos(r.paperOpenedAt.toISOString()) : "?"}  ${result}` +
        (r.paperNote ? `  (${r.paperNote})` : ""),
    );
  }
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
