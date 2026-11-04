// npm run oanda:check — prints the last 5 closed D, H4 and M15 candles for
// every enabled watchlist pair. Read-only: writes nothing to the database.
import "./load-env";
import type { Pair, Timeframe } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import { getWatchlist } from "@/lib/db/watchlist";
import { priceDecimals } from "@/lib/market/pip";
import { isMarketOpen } from "@/lib/market/time";
import { getWorkerEnv } from "./env";
import { silentLogger } from "./log";
import { createOandaClient } from "./oanda/client";

const TIMEFRAMES: readonly Timeframe[] = ["D", "H4", "M15"];
const CANDLES_PER_ROW = 5;

function formatIn(timeZone: string, iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  })
    .format(new Date(iso))
    .replaceAll(",", "");
}

function row(cells: readonly string[], widths: readonly number[]): string {
  return cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ");
}

async function main(): Promise<number> {
  const env = getWorkerEnv();
  const client = createOandaClient({ token: env.oandaApiToken, env: env.oandaEnv, logger: silentLogger });
  const pairs: Pair[] = (await getWatchlist()).filter((p) => p.enabled).map((p) => p.pair);

  const now = new Date();
  console.log(`OANDA ${env.oandaEnv} · ${pairs.length} enabled pairs · ${now.toISOString()}`);
  console.log(`Market open now: ${isMarketOpen(now) ? "yes" : "no"}\n`);

  const widths = [7, 3, 20, 20, 20, 10, 10, 10, 10];
  console.log(row(["PAIR", "TF", "OPEN (LAGOS)", "OPEN (UTC)", "OPEN (NEW YORK)", "O", "H", "L", "C"], widths));

  let failures = 0;
  for (const pair of pairs) {
    const decimals = priceDecimals(pair);
    for (const timeframe of TIMEFRAMES) {
      try {
        const candles = await client.fetchCandles(pair, timeframe, { count: CANDLES_PER_ROW });
        for (const c of candles) {
          console.log(
            row(
              [
                pair,
                timeframe,
                formatIn("Africa/Lagos", c.time),
                formatIn("UTC", c.time),
                formatIn("America/New_York", c.time),
                c.open.toFixed(decimals),
                c.high.toFixed(decimals),
                c.low.toFixed(decimals),
                c.close.toFixed(decimals),
              ],
              widths,
            ),
          );
        }
      } catch (error) {
        failures++;
        console.log(`${pair.padEnd(7)}  ${timeframe.padEnd(3)}  FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log("");
  }

  console.log(failures === 0 ? "All requests OK." : `${failures} request(s) failed.`);
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
