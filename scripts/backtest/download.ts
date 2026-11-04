// npm run data:download -- --pair EUR_USD [--pair GBP_USD | --all]
//   --from 2026-01-01 [--to 2026-06-30] [--timeframes D,H4,M15]
// Writes scripts/backtest/data/<PAIR>_<TF>.csv (git-ignored), oldest first.
import "../../worker/load-env";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import { getWatchlist } from "@/lib/db/watchlist";
import { priceDecimals } from "@/lib/market/pip";
import { TIMEFRAME_MS } from "@/lib/market/time";
import { getWorkerEnv } from "../../worker/env";
import { silentLogger } from "../../worker/log";
import { createOandaClient } from "../../worker/oanda/client";
import { findLongGaps } from "./gaps";

const DATA_DIR = path.join(process.cwd(), "scripts", "backtest", "data");

const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"] as const;
const TIMEFRAMES = ["D", "H4", "M15"] as const;

const dateArg = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be a date like 2026-01-01")
  .transform((s) => new Date(s));

const argsSchema = z
  .object({
    pair: z.array(z.enum(PAIRS)).default([]),
    all: z.boolean().default(false),
    from: dateArg,
    to: dateArg.optional(),
    timeframes: z
      .string()
      .default("D,H4,M15")
      .transform((s) => s.split(",").map((t) => t.trim()))
      .pipe(z.array(z.enum(TIMEFRAMES)).min(1)),
  })
  .refine((a) => a.all !== a.pair.length > 0, "pass either --pair (repeatable) or --all");

function toCsv(candles: readonly Candle[], decimals: number): string {
  const lines = candles.map((c) =>
    [c.time, c.open, c.high, c.low, c.close]
      .map((v) => (typeof v === "number" ? v.toFixed(decimals) : v))
      .join(","),
  );
  return ["time,open,high,low,close", ...lines].join("\n") + "\n";
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      pair: { type: "string", multiple: true },
      all: { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
      timeframes: { type: "string" },
    },
  });
  const parsed = argsSchema.safeParse(values);
  if (!parsed.success) {
    console.error(`Bad arguments:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".") || "args"}: ${i.message}`).join("\n")}`);
    return 1;
  }
  const args = parsed.data;
  const to = args.to ?? new Date();
  if (!(args.from < to)) {
    console.error("--from must be before --to");
    return 1;
  }

  const env = getWorkerEnv();
  const client = createOandaClient({ token: env.oandaApiToken, env: env.oandaEnv, logger: silentLogger });
  const pairs: Pair[] = args.all
    ? (await getWatchlist()).filter((p) => p.enabled).map((p) => p.pair)
    : args.pair;

  await mkdir(DATA_DIR, { recursive: true });
  console.log(`Downloading ${args.from.toISOString()} → ${to.toISOString()} (${env.oandaEnv})\n`);

  let failures = 0;
  for (const pair of pairs) {
    for (const timeframe of args.timeframes as Timeframe[]) {
      const file = path.join(DATA_DIR, `${pair}_${timeframe}.csv`);
      try {
        const candles = await client.fetchCandles(pair, timeframe, { from: args.from, to });
        const unique = new Set(candles.map((c) => c.time)).size;
        if (unique !== candles.length) throw new Error(`${candles.length - unique} duplicate times`);
        await writeFile(file, toCsv(candles, priceDecimals(pair)), "utf8");

        const first = candles[0]?.time ?? "—";
        const last = candles.at(-1)?.time ?? "—";
        console.log(`${path.basename(file).padEnd(16)} ${String(candles.length).padStart(6)} rows  ${first} → ${last}`);
        for (const gap of findLongGaps(candles, TIMEFRAME_MS[timeframe])) {
          console.log(`  ⚠ gap of ${gap.hours.toFixed(1)}h after ${gap.after} (next candle ${gap.next})`);
        }
      } catch (error) {
        failures++;
        console.log(`${path.basename(file).padEnd(16)} FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return failures === 0 ? 0 : 1;
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
