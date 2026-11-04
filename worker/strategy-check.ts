// npm run strategy:check -- --pair EUR_USD
// Fetches recent closed candles from OANDA and the Settings row, then prints
// what dg-v1 sees right now: trends, liquidity levels, latest swings and the
// events it would emit with no open setups. Read-only: writes nothing.
import "./load-env";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { Pair, Timeframe } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import { getSettings } from "@/lib/db/settings";
import { isMarketOpen } from "@/lib/market/time";
import { getStrategy } from "@/lib/strategy/registry";
import { getLiquidityLevels } from "@/lib/strategy/shared/liquidity";
import { tradeDirection } from "@/lib/strategy/shared/sweep";
import { findSwings } from "@/lib/strategy/shared/swings";
import { getTrend } from "@/lib/strategy/shared/trend";
import type { SetupEvent, StrategySettings } from "@/lib/strategy/types";
import { getWorkerEnv } from "./env";
import { lagos, price } from "./format";
import { silentLogger } from "./log";
import { createOandaClient } from "./oanda/client";

const STRATEGY_ID = "dg-v1";

/** Enough history for swings on each timeframe and the 2-day EQH/EQL window. */
const CANDLE_COUNTS: Record<Timeframe, number> = { D: 120, H4: 300, M15: 400 };

const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"] as const;
const argsSchema = z.object({ pair: z.enum(PAIRS) });

function describeEvent(pair: Pair, event: SetupEvent): string {
  switch (event.type) {
    case "SWEEP":
      return `SWEEP ${event.direction} ${event.sweepType} ${price(pair, event.sweepLevel)} · extreme ${price(pair, event.sweepExtreme)} · BOS ${price(pair, event.bosLevel)} · expires ${lagos(event.expiresAt)}`;
    case "EXTEND":
      return `EXTEND ${event.dedupeKey} → ${price(pair, event.sweepExtreme)}`;
    case "CONFIRM": {
      const t = event.ticket;
      return `CONFIRM entry ${price(pair, t.entry)} stop ${price(pair, t.stop)} target ${price(pair, t.target)} · ${t.stopPips} pips · ${t.lotSize} lots`;
    }
    case "EXPIRE":
      return `EXPIRE ${event.dedupeKey}`;
    case "SKIP_INVALID":
      return `SKIP_INVALID ${event.dedupeKey}: ${event.reason}`;
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { pair: { type: "string" } } });
  const args = argsSchema.safeParse(values);
  if (!args.success) {
    console.error(`Usage: npm run strategy:check -- --pair EUR_USD (one of ${PAIRS.join(", ")})`);
    return 1;
  }
  const pair = args.data.pair;

  const env = getWorkerEnv();
  const client = createOandaClient({ token: env.oandaApiToken, env: env.oandaEnv, logger: silentLogger });
  const row = await getSettings();
  const settings: StrategySettings = {
    accountSizeUsd: row.accountSizeUsd,
    riskPct: row.riskPct,
    rewardRatio: row.rewardRatio,
    stopBufferPips: row.stopBufferPips,
    watchExpiryMinutes: row.watchExpiryMinutes,
    swingStrength: row.swingStrength,
    equalTolerancePips: row.equalTolerancePips,
  };

  const [D, H4, M15] = await Promise.all(
    (["D", "H4", "M15"] as const).map((tf) =>
      client.fetchCandles(pair, tf, { count: CANDLE_COUNTS[tf] }),
    ),
  );
  if (!D || !H4 || !M15) throw new Error("Missing candles");
  const now = new Date();
  const strategy = getStrategy(STRATEGY_ID);
  const p = (v: number) => price(pair, v);

  console.log(`${strategy.name} · ${pair} · ${lagos(now.toISOString())} Lagos · market ${isMarketOpen(now) ? "open" : "closed"}`);
  console.log(`Candles: D ${D.length}, H4 ${H4.length}, M15 ${M15.length} (latest M15 ${lagos(M15.at(-1)?.time ?? "")})`);
  console.log(`Settings: swing strength ${settings.swingStrength}, equal tolerance ${settings.equalTolerancePips} pips, buffer ${settings.stopBufferPips} pips, expiry ${settings.watchExpiryMinutes} min, risk ${settings.riskPct}% of $${settings.accountSizeUsd}\n`);

  for (const [label, candles] of [["D", D], ["H4", H4]] as const) {
    const swings = findSwings(candles, settings.swingStrength);
    const highs = swings.highs.slice(-2).map((s) => p(s.price)).join(" → ") || "—";
    const lows = swings.lows.slice(-2).map((s) => p(s.price)).join(" → ") || "—";
    console.log(`${label.padEnd(2)} trend: ${getTrend(candles, settings.swingStrength).padEnd(5)}  last swing highs ${highs} · lows ${lows}`);
  }
  const direction = tradeDirection(
    getTrend(D, settings.swingStrength),
    getTrend(H4, settings.swingStrength),
  );
  console.log(`Direction allowed: ${direction ?? "none (D and H4 disagree or range)"}\n`);

  const levels = getLiquidityLevels({ pair, candles: { D, M15 }, settings });
  console.log("Liquidity levels:");
  for (const level of levels) {
    console.log(`  ${level.type}  ${p(level.price)}  (since ${lagos(level.since)})`);
  }
  if (!levels.some((l) => l.type === "EQH" || l.type === "EQL")) {
    console.log("  no equal highs/lows in the current + previous forex day");
  }

  const m15Swings = findSwings(M15, settings.swingStrength);
  const lastHigh = m15Swings.highs.at(-1);
  const lastLow = m15Swings.lows.at(-1);
  console.log(`\nLatest M15 swing high: ${lastHigh ? `${p(lastHigh.price)} at ${lagos(lastHigh.time)}` : "—"}`);
  console.log(`Latest M15 swing low:  ${lastLow ? `${p(lastLow.price)} at ${lagos(lastLow.time)}` : "—"}`);

  const events = strategy.evaluate({ pair, now, candles: { D, H4, M15 }, settings, openSetups: [] });
  console.log(`\nEvents ${strategy.id} would emit now (no open setups):`);
  if (events.length === 0) console.log("  none");
  for (const event of events) console.log(`  ${describeEvent(pair, event)}`);
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
