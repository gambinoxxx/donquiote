// npm run worker:replay -- --strategy dg-v1 --pair EUR_USD [--pair GBP_USD]
//   --from 2026-01-01 --to 2026-03-31
// Feeds the history CSVs through the SAME cycle code as the live worker
// (in-memory store, simulated clock running the real scheduler times), then
// compares every alert to the backtester's setups for the same range, and
// every paper trade to the backtester's trade result (status, exit, R, USD).
// Prints MATCH or the first differences. Reads Settings read-only; writes
// nothing to the database.
import "./load-env";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { hoursToCandles } from "@/lib/market/time";
import { getDb } from "@/lib/db/client";
import { getStrategy } from "@/lib/strategy/registry";
import { countClosedBy } from "@/lib/strategy/replay";
import { loadCandlesCsv } from "../scripts/backtest/csv";
import { runBacktest } from "../scripts/backtest/engine";
import { runCycle } from "./cycle";
import { memoryPriceSource } from "./prices";
import { nextRunAt, RUN_DELAY_MS } from "./scheduler";
import { MemoryStore, type MemoryAlert } from "./store";
import { PrismaStore } from "./store-prisma";

const DATA_DIR = path.join(process.cwd(), "scripts", "backtest", "data");
const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"] as const;
const TIMEFRAMES: readonly Timeframe[] = ["D", "H4", "M15"];
const M15_MS = 15 * 60_000;

const dateArg = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be a date like 2026-01-01")
  .transform((s) => new Date(s));
const argsSchema = z.object({
  strategy: z.string().default("dg-v1"),
  pair: z.array(z.enum(PAIRS)).min(1, "pass at least one --pair"),
  from: dateArg,
  to: dateArg,
});

/** Comparable view of an alert / setup. */
interface Row {
  key: string;
  status: string;
  sweepType: string;
  sweepLevel: number;
  sweepExtreme: number;
  bosLevel: number;
  expiresAt: string;
  readyAt?: string;
  entry?: number;
  stop?: number;
  target?: number;
  lotSize?: number;
  note?: string;
  paper?: {
    status: string;
    closedAt?: string;
    exitPrice?: number;
    resultR?: number;
    pnlUsd?: number;
    note?: string;
  };
}

function fromAlert(a: MemoryAlert): Row {
  return {
    key: a.dedupeKey,
    status: a.status,
    sweepType: a.sweepType,
    sweepLevel: a.sweepLevel,
    sweepExtreme: a.sweepExtreme,
    bosLevel: a.bosLevel,
    expiresAt: a.expiresAt,
    ...(a.readyAt && { readyAt: a.readyAt, entry: a.entry, stop: a.stop, target: a.target, lotSize: a.lotSize }),
    ...(a.statusNote && { note: a.statusNote }),
    ...(a.paperStatus && {
      paper: {
        status: a.paperStatus,
        ...(a.paperStatus !== "OPEN" && {
          closedAt: a.paperClosedAt,
          exitPrice: a.paperExitPrice,
          resultR: a.paperResultR,
          pnlUsd: a.paperPnlUsd,
        }),
        ...(a.paperNote && { note: a.paperNote }),
      },
    }),
  };
}

/** "3W / 2L / 1U / 0 open, +4.68R, +$234.00" */
function paperLine(rows: readonly Row[]): string {
  const n = (status: string) => rows.filter((r) => r.paper?.status === status).length;
  const netR = rows.reduce((sum, r) => sum + (r.paper?.resultR ?? 0), 0);
  const netUsd = rows.reduce((sum, r) => sum + (r.paper?.pnlUsd ?? 0), 0);
  const sign = (x: number) => (x < 0 ? "-" : "+");
  return (
    `${n("WIN")}W / ${n("LOSS")}L / ${n("UNRESOLVED")}U / ${n("OPEN")} open, ` +
    `${sign(netR)}${Math.abs(netR).toFixed(2)}R, ${sign(netUsd)}$${Math.abs(netUsd).toFixed(2)}`
  );
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      strategy: { type: "string" },
      pair: { type: "string", multiple: true },
      from: { type: "string" },
      to: { type: "string" },
    },
  });
  const parsed = argsSchema.safeParse(values);
  if (!parsed.success) {
    console.error(parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("\n"));
    return 1;
  }
  const { strategy: strategyId, pair: pairs, from, to } = parsed.data;
  const strategy = getStrategy(strategyId);
  const { strategy: settings, paperTimeoutHours } = await new PrismaStore().loadSettings(); // read-only
  const timeoutCandles = hoursToCandles(paperTimeoutHours, "M15");

  // Full history per pair, and the part already closed when the replay starts.
  const full: Partial<Record<Pair, Record<Timeframe, Candle[]>>> = {};
  const seed: Partial<Record<Pair, Partial<Record<Timeframe, Candle[]>>>> = {};
  const cursors: Array<{ pair: Pair; strategyId: string; lastCandleTime: string }> = [];
  for (const pair of pairs) {
    const [D, H4, M15] = await Promise.all(
      TIMEFRAMES.map((tf) => loadCandlesCsv(path.join(DATA_DIR, `${pair}_${tf}.csv`))),
    );
    const byTf = { D: D ?? [], H4: H4 ?? [], M15: M15 ?? [] };
    full[pair] = byTf;
    seed[pair] = Object.fromEntries(
      TIMEFRAMES.map((tf) => [tf, byTf[tf].slice(0, countClosedBy(byTf[tf], tf, from.getTime()))]),
    );
    // Cursor = last M15 candle before `from`, so the first processed candle opens at ≥ from.
    const before = byTf.M15.filter((c) => c.time < from.toISOString()).at(-1);
    if (before) cursors.push({ pair, strategyId, lastCandleTime: before.time });
  }

  const store = new MemoryStore({
    settings,
    paperTimeoutHours,
    enabledPairs: [...pairs],
    strategyModes: [{ strategyId, mode: "LIVE" }],
    candles: seed,
    cursors,
  });
  const prices = memoryPriceSource(full);

  // Simulated clock: the real scheduler's run times between from and to.
  const started = performance.now();
  let cycles = 0;
  let runAt = nextRunAt(new Date(from.getTime() - 1));
  while (runAt.getTime() - RUN_DELAY_MS <= to.getTime()) {
    const report = await runCycle({ store, prices, now: runAt });
    if (report.status !== "ok") {
      console.error(`Cycle at ${runAt.toISOString()} was ${report.status}: ${report.message}`);
      return 1;
    }
    cycles++;
    runAt = nextRunAt(new Date(runAt.getTime() + 1));
  }
  const replayMs = performance.now() - started;

  console.log(`Replay · ${strategy.name} · ${from.toISOString()} → ${to.toISOString()}`);
  console.log(`${cycles} worker cycles in ${(replayMs / 1000).toFixed(1)} s (in-memory store, same cycle code as live)\n`);

  let allMatch = true;
  for (const pair of pairs) {
    const candles = full[pair] as Record<Timeframe, Candle[]>;
    const backtest = runBacktest({
      strategy,
      pair,
      candles,
      settings,
      fromMs: from.getTime(),
      toMs: to.getTime(),
      timeoutCandles,
    });
    const tradesByKey = new Map(backtest.trades.map((t) => [t.setup.dedupeKey, t]));
    const expected: Row[] = backtest.setups.map((s) => {
      const trade = tradesByKey.get(s.dedupeKey);
      const ticket = trade?.ticket;
      const r = trade?.result;
      const status = s.status === "CONFIRMED" ? "READY" : s.status === "INVALID" ? "EXPIRED" : s.status;
      return {
        key: s.dedupeKey,
        status,
        sweepType: s.sweepType,
        sweepLevel: s.sweepLevel,
        sweepExtreme: s.sweepExtreme,
        bosLevel: s.bosLevel,
        expiresAt: new Date(Date.parse(s.sweepTime) + M15_MS + settings.watchExpiryMinutes * 60_000).toISOString(),
        ...(ticket &&
          s.confirmTime && {
            readyAt: new Date(Date.parse(s.confirmTime) + M15_MS).toISOString(),
            entry: ticket.entry,
            stop: ticket.stop,
            target: ticket.target,
            lotSize: ticket.lotSize,
          }),
        ...(s.reason && { note: s.reason }),
        ...(r && {
          paper: {
            status: r.status,
            ...(r.status !== "OPEN" && {
              closedAt: r.closedAt,
              exitPrice: r.exitPrice,
              resultR: r.resultR,
              pnlUsd: r.pnlUsd,
            }),
            ...(r.note && { note: r.note }),
          },
        }),
      };
    });
    const actual = store
      .listAlerts(strategyId)
      .filter((a) => a.pair === pair)
      .map(fromAlert);

    const sortRows = (rows: Row[]) => [...rows].sort((a, b) => a.key.localeCompare(b.key));
    const e = sortRows(expected);
    const a = sortRows(actual);
    const diffs: string[] = [];
    const keys = [...new Set([...e, ...a].map((r) => r.key))].sort();
    for (const key of keys) {
      const er = e.find((r) => r.key === key);
      const ar = a.find((r) => r.key === key);
      if (JSON.stringify(er) !== JSON.stringify(ar)) {
        diffs.push(`  ${key}\n    backtest: ${JSON.stringify(er) ?? "—"}\n    worker:   ${JSON.stringify(ar) ?? "—"}`);
      }
    }
    const ready = (rows: Row[]) => rows.filter((r) => r.status === "READY").length;
    const summary =
      `${a.length} alerts (${ready(a)} READY) vs backtest ${e.length} setups (${ready(e)} confirmed)\n` +
      `    paper — worker:   ${paperLine(a)}\n` +
      `    paper — backtest: ${paperLine(e)}`;
    if (diffs.length === 0) {
      console.log(`${pair}: MATCH — ${summary}`);
    } else {
      allMatch = false;
      console.log(`${pair}: ${diffs.length} DIFFERENCES — ${summary}`);
      console.log(diffs.slice(0, 5).join("\n"));
    }
  }
  console.log(allMatch ? "\nMATCH" : "\nDIFFERENT");
  return allMatch ? 0 : 1;
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
