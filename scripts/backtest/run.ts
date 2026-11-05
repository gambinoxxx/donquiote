// npm run backtest -- [--strategy dg-v1] (--pair EUR_USD ... | --all)
//   --from 2026-01-01 [--to 2026-11-01]
//   [--risk 0.5 --account 10000 --buffer 3 --expiry 120 --tolerance 2 --swing 2]
// Replays scripts/backtest/data CSVs through a strategy and the paper-trade
// resolver. Reads Settings from the database read-only; writes only to
// scripts/backtest/results/ (git-ignored).
import "../../worker/load-env";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { Pair } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import { getSettings } from "@/lib/db/settings";
import { TIMEFRAME_MS } from "@/lib/market/time";
import { getStrategy } from "@/lib/strategy/registry";
import type { StrategySettings } from "@/lib/strategy/types";
import { loadCandlesCsv } from "./csv";
import { runBacktest, type SetupRecord, type TradeRecord } from "./engine";
import { formatReport, tradesCsv } from "./report";
import { summarize } from "./stats";

const ROOT = path.join(process.cwd(), "scripts", "backtest");
const DATA_DIR = path.join(ROOT, "data");
const RESULTS_DIR = path.join(ROOT, "results");
const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"] as const;

const dateArg = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be a date like 2026-01-01")
  .transform((s) => new Date(s));
const positive = z.coerce.number().positive();

const argsSchema = z
  .object({
    strategy: z.string().default("dg-v1"),
    pair: z.array(z.enum(PAIRS)).default([]),
    all: z.boolean().default(false),
    from: dateArg,
    to: dateArg.optional(),
    risk: positive.optional(),
    account: positive.optional(),
    buffer: z.coerce.number().min(0).optional(),
    expiry: z.coerce.number().int().positive().optional(),
    tolerance: z.coerce.number().min(0).optional(),
    swing: z.coerce.number().int().positive().optional(),
  })
  .refine((a) => a.all !== a.pair.length > 0, "pass either --pair (repeatable) or --all");

async function pairsWithData(): Promise<Pair[]> {
  const files = new Set(await readdir(DATA_DIR).catch(() => [] as string[]));
  return PAIRS.filter((p) => ["D", "H4", "M15"].every((tf) => files.has(`${p}_${tf}.csv`)));
}

const stamp = (d: Date) => d.toISOString().slice(0, 10);

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      strategy: { type: "string" },
      pair: { type: "string", multiple: true },
      all: { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
      risk: { type: "string" },
      account: { type: "string" },
      buffer: { type: "string" },
      expiry: { type: "string" },
      tolerance: { type: "string" },
      swing: { type: "string" },
    },
  });
  const parsed = argsSchema.safeParse(values);
  if (!parsed.success) {
    console.error(`Bad arguments:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".") || "args"}: ${i.message}`).join("\n")}`);
    return 1;
  }
  const args = parsed.data;
  const strategy = getStrategy(args.strategy);

  // Settings: the database row as defaults (read-only), flags override.
  const row = await getSettings();
  const settings: StrategySettings = {
    accountSizeUsd: args.account ?? row.accountSizeUsd,
    riskPct: args.risk ?? row.riskPct,
    rewardRatio: row.rewardRatio,
    stopBufferPips: args.buffer ?? row.stopBufferPips,
    watchExpiryMinutes: args.expiry ?? row.watchExpiryMinutes,
    swingStrength: args.swing ?? row.swingStrength,
    equalTolerancePips: args.tolerance ?? row.equalTolerancePips,
  };

  const available = await pairsWithData();
  const pairs = args.all ? available : args.pair;
  const missing = pairs.filter((p) => !available.includes(p));
  if (missing.length > 0 || pairs.length === 0) {
    console.error(`No CSVs for: ${missing.join(", ") || "any pair"}. Run npm run data:download first.`);
    return 1;
  }

  const started = performance.now();
  const results: Array<{ pair: Pair; setups: SetupRecord[]; trades: TradeRecord[]; lastClose: number }> = [];
  for (const pair of pairs) {
    const [D, H4, M15] = await Promise.all(
      (["D", "H4", "M15"] as const).map((tf) => loadCandlesCsv(path.join(DATA_DIR, `${pair}_${tf}.csv`))),
    );
    const last = M15?.at(-1);
    if (!D || !H4 || !M15 || !last) throw new Error(`${pair}: empty data`);
    const lastClose = Date.parse(last.time) + TIMEFRAME_MS.M15;
    const t0 = performance.now();
    const out = runBacktest({
      strategy,
      pair,
      candles: { D, H4, M15 },
      settings,
      fromMs: args.from.getTime(),
      toMs: args.to ? args.to.getTime() : lastClose,
    });
    console.error(`${pair}: ${out.steps} M15 steps, ${out.setups.length} setups, ${out.trades.length} trades in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    results.push({ pair, setups: out.setups, trades: out.trades, lastClose });
  }
  const durationMs = performance.now() - started;

  const toDate = args.to ?? new Date(Math.max(...results.map((r) => r.lastClose)));
  const generatedAt = new Date();
  const report = formatReport(
    {
      strategyId: strategy.id,
      strategyName: strategy.name,
      from: args.from.toISOString(),
      to: toDate.toISOString(),
      settings,
      generatedAt: generatedAt.toISOString(),
      durationMs,
    },
    results.map((r) => ({ pair: r.pair, summary: summarize(r.setups, r.trades) })),
    summarize(
      results.flatMap((r) => r.setups),
      results.flatMap((r) => r.trades),
    ),
  );

  await mkdir(RESULTS_DIR, { recursive: true });
  const base = `${strategy.id}_${stamp(args.from)}_${stamp(toDate)}_${generatedAt.toISOString().replace(/[:.]/g, "-")}`;
  const csvFile = path.join(RESULTS_DIR, `${base}.csv`);
  const mdFile = path.join(RESULTS_DIR, `${base}.md`);
  await writeFile(csvFile, tradesCsv(results.flatMap((r) => r.trades)), "utf8");
  await writeFile(mdFile, `${report}\n`, "utf8");

  console.log(report);
  console.log(`\nTrades CSV: ${path.relative(process.cwd(), csvFile)}`);
  console.log(`Summary:    ${path.relative(process.cwd(), mdFile)}`);
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
