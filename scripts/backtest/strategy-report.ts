// npm run backtest:report -- --strategy gemini-fvg [--reference counts.json] [--compare dg-v1,gemini-fvg] [--out doc/reports/backtest-gemini-fvg.md]
// Backtests one strategy on every pair with CSV data, from 2026-01-01 to the
// latest candle, and reports two periods: in-sample (Jan–Jun 2026) and
// out-of-sample (Jul 2026 → latest). Trades are split by the time they
// became Ready. Mid prices, no spread (same as the dg-v1 report).
// --reference: JSON { "EUR_USD": { "is": 5, "oos": 7 }, ... } with the
// reference script's trade counts, to print a comparison table.
// --compare: other strategy ids, backtested the same way, shown as one row
// each (all 5 pairs) next to this strategy for both periods.
// The break-even win rate uses the strategy's own reward ratio
// (Strategy.rewardRatio, else Settings): 1 ÷ (1 + R).
// Reads Settings (read-only); writes only the report file.
import "../../worker/load-env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Pair } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import { getSettings } from "@/lib/db/settings";
import { hoursToCandles, TIMEFRAME_MS } from "@/lib/market/time";
import { getStrategyInfo, type StrategyInfo } from "@/lib/strategy/registry";
import type { Strategy, StrategySettings } from "@/lib/strategy/types";
import { loadCandlesCsv } from "./csv";
import { runBacktest, type SetupRecord, type TradeRecord } from "./engine";
import { summarize, type Summary } from "./stats";

const DATA_DIR = path.join(process.cwd(), "scripts", "backtest", "data");
const PAIRS: readonly Pair[] = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF"];
const FROM = "2026-01-01T00:00:00.000Z";
const SPLIT = "2026-07-01T00:00:00.000Z";

type Period = "is" | "oos";
const PERIOD_LABEL: Record<Period, string> = { is: "In-sample", oos: "Out-of-sample" };

const r2 = (n: number) => (n < 0 ? "−" : "+") + Math.abs(n).toFixed(2);
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);

function row(label: string, s: Summary): string {
  return `| ${label} | ${s.trades} | ${s.wins} / ${s.losses} | ${pct(s.winRate)} | ${r2(s.netR)}R | ${s.avgR === null ? "—" : r2(s.avgR) + "R"} | ${s.worstLosingStreak} | ${s.maxDrawdownR.toFixed(2)}R | ${s.unresolved} | ${s.notFilled} | ${s.open} |`;
}
const HEADER =
  "| | Trades | W / L | Win rate | Net R | Avg R | Worst streak | Max DD | Unresolved | Not filled | Open at end |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";

type ByPair = Map<Pair, Record<Period, { setups: SetupRecord[]; trades: TradeRecord[] }>>;

/** Backtests one strategy on every pair from FROM to each pair's latest candle, split by period. */
async function backtestAllPairs(strategy: Strategy, settings: StrategySettings, timeoutCandles: number) {
  const byPair: ByPair = new Map();
  let firstCandle = "";
  let lastCandle = "";
  let lastClose = 0;
  for (const pair of PAIRS) {
    const [D, H4, M15] = await Promise.all(
      (["D", "H4", "M15"] as const).map((tf) => loadCandlesCsv(path.join(DATA_DIR, `${pair}_${tf}.csv`))),
    );
    const last = M15?.at(-1);
    if (!D || !H4 || !M15 || !last) throw new Error(`${pair}: no CSV data (npm run data:download)`);
    firstCandle = firstCandle && firstCandle < (M15[0]?.time ?? "") ? firstCandle : (M15[0]?.time ?? "");
    lastCandle = lastCandle > last.time ? lastCandle : last.time;
    const toMs = Date.parse(last.time) + TIMEFRAME_MS.M15;
    lastClose = Math.max(lastClose, toMs);
    const out = runBacktest({
      strategy,
      pair,
      candles: { D, H4, M15 },
      settings,
      fromMs: Date.parse(FROM),
      toMs,
      timeoutCandles,
    });
    const period = (iso: string): Period => (iso < SPLIT ? "is" : "oos");
    byPair.set(pair, {
      is: {
        setups: out.setups.filter((s) => period(s.sweepTime) === "is"),
        trades: out.trades.filter((t) => period(t.trade.openedAt) === "is"),
      },
      oos: {
        setups: out.setups.filter((s) => period(s.sweepTime) === "oos"),
        trades: out.trades.filter((t) => period(t.trade.openedAt) === "oos"),
      },
    });
    console.error(`${strategy.id} ${pair}: ${out.trades.length} Ready trades`);
  }
  return { byPair, firstCandle, lastCandle, lastClose };
}

function allPairs(byPair: ByPair, period: Period): Summary {
  return summarize(
    PAIRS.flatMap((p) => byPair.get(p)?.[period].setups ?? []),
    PAIRS.flatMap((p) => byPair.get(p)?.[period].trades ?? []),
  );
}

/** Break-even win rate at reward ratio R (W ÷ (W + L) with +R wins, −1R losses). */
const breakEven = (rewardRatio: number) => 1 / (1 + rewardRatio);
const ratioOf = (info: StrategyInfo, settings: StrategySettings) => info.strategy.rewardRatio ?? settings.rewardRatio;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      strategy: { type: "string" },
      reference: { type: "string" },
      compare: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.strategy) {
    console.error("pass --strategy <id>");
    return 1;
  }
  const info = getStrategyInfo(values.strategy);
  const row0 = await getSettings();
  const settings: StrategySettings = {
    accountSizeUsd: row0.accountSizeUsd,
    riskPct: row0.riskPct,
    rewardRatio: row0.rewardRatio,
    stopBufferPips: row0.stopBufferPips,
    watchExpiryMinutes: row0.watchExpiryMinutes,
    swingStrength: row0.swingStrength,
    equalTolerancePips: row0.equalTolerancePips,
  };
  const timeoutCandles = hoursToCandles(row0.paperTimeoutHours, "M15");
  const reference = values.reference
    ? (JSON.parse(await readFile(values.reference, "utf8")) as Partial<Record<Pair, Record<Period, number>>>)
    : null;

  const started = performance.now();
  const { byPair, firstCandle, lastCandle, lastClose } = await backtestAllPairs(info.strategy, settings, timeoutCandles);
  const compare = await Promise.all(
    (values.compare ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .map(async (id) => {
        const other = getStrategyInfo(id);
        return { info: other, ...(await backtestAllPairs(other.strategy, settings, timeoutCandles)) };
      }),
  );
  const seconds = (performance.now() - started) / 1000;

  const end = new Date(lastClose).toISOString();
  const lines: string[] = [
    `# Backtest · ${info.name} (\`${info.id}\`, ${info.code})`,
    "",
    `Generated ${new Date().toISOString()} by \`npm run backtest:report -- --strategy ${info.id}\` in ${seconds.toFixed(1)} s.`,
    "",
    `- **Data:** OANDA mid prices (CSV in \`scripts/backtest/data/\`), M15 candles from ${firstCandle} to ${lastCandle} (UTC); D and 4H from the same start. Candles before ${FROM.slice(0, 10)} are warm-up only.`,
    `- **Periods** (by the time a trade became Ready): in-sample ${FROM.slice(0, 10)} → ${SPLIT.slice(0, 10)}; out-of-sample ${SPLIT.slice(0, 10)} → ${end} (latest data).`,
    `- **Costs:** none — mid prices, no spread, commission or slippage (same as the dg-v1 report). Real results would be worse.`,
    `- **Settings** (database, read-only): account $${settings.accountSizeUsd} fixed (no compounding), risk ${settings.riskPct}% ($${(settings.accountSizeUsd * settings.riskPct) / 100} = 1R), paper time limit ${timeoutCandles} M15 candles. Strategy numbers are constants in \`lib/strategy/${info.id}/\`${info.id === "dg-v2-candidate" ? " plus dg-v1's settings (stop buffer, expiry, swing strength, equal tolerance)" : ""}.`,
    `- **Reward ratio:** ${ratioOf(info, settings)}R, so the break-even win rate is ${pct(breakEven(ratioOf(info, settings)))} (1 ÷ (1 + R)).`,
    ...(info.strategy.exitAtUtcHour !== undefined
      ? [`- **Time exit:** a trade still open at ${String(info.strategy.exitAtUtcHour).padStart(2, "0")}:00 UTC on its day closes at that candle's close as Unresolved, with its R.`]
      : []),
    ...(info.strategy.usesRedNews
      ? ["- **News rule not applied:** the live rule skips a breakout with red calendar news within 30 min, but there is no stored news history for the backtest period, so this backtest takes every breakout. Live results may have fewer trades."]
      : []),
    "- **Counting:** Trades = Ready alerts whose entry was filled (market entries always are). Win rate = W ÷ (W + L); Unresolved (time limit) is not in the win rate but its R is in net R; Not filled (limit entry never reached) is not a trade: 0R, not in win rate, R or streaks. Avg R = net R ÷ closed trades. Worst streak = longest run of losses in close order.",
    "",
    "Sample results from historical data. Not a promise of future results, and not a judgement of the strategy.",
    "",
  ];
  for (const period of ["is", "oos"] as const) {
    const all = summarize(
      PAIRS.flatMap((p) => byPair.get(p)?.[period].setups ?? []),
      PAIRS.flatMap((p) => byPair.get(p)?.[period].trades ?? []),
    );
    lines.push(`## ${PERIOD_LABEL[period]}`, "", HEADER, row("**All 5 pairs**", all));
    for (const pair of PAIRS) {
      const data = byPair.get(pair);
      if (data) lines.push(row(pair, summarize(data[period].setups, data[period].trades)));
    }
    lines.push("", `Setups (sweeps): ${all.setups} · confirmed (Ready) ${all.confirmed} · expired ${all.expired} · skipped (invalid) ${all.invalid}.`, "");
    const be = breakEven(ratioOf(info, settings));
    lines.push(
      all.winRate === null
        ? `Break-even win rate at ${ratioOf(info, settings)}R: ${pct(be)}; no decided trades in this period.`
        : `Break-even win rate at ${ratioOf(info, settings)}R: ${pct(be)}. Win rate ${pct(all.winRate)} is **${all.winRate > be ? "above" : all.winRate < be ? "below" : "equal to"}** it.`,
      "",
    );
  }

  if (compare.length > 0) {
    lines.push(
      "## Comparison (all 5 pairs, same periods, same settings)",
      "",
      "| Strategy | Period | Trades | Win rate | Break-even | Net R | Avg R | Worst streak | Max DD | Unresolved |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    const rows = [{ info, byPair }, ...compare];
    for (const period of ["is", "oos"] as const) {
      for (const { info: i, byPair: b } of rows) {
        const sum = allPairs(b, period);
        lines.push(
          `| ${i.name} (\`${i.id}\`) | ${PERIOD_LABEL[period]} | ${sum.trades} | ${pct(sum.winRate)} | ${pct(breakEven(ratioOf(i, settings)))} | ${r2(sum.netR)}R | ${sum.avgR === null ? "—" : r2(sum.avgR) + "R"} | ${sum.worstLosingStreak} | ${sum.maxDrawdownR.toFixed(2)}R | ${sum.unresolved} |`,
        );
      }
    }
    lines.push("");
  }

  if (reference) {
    lines.push(
      "## Trade count vs the reference script",
      "",
      "| Pair | In-sample app | In-sample ref | Out-of-sample app | Out-of-sample ref |",
      "| --- | ---: | ---: | ---: | ---: |",
    );
    let totals = { ai: 0, ri: 0, ao: 0, ro: 0 };
    for (const pair of PAIRS) {
      const data = byPair.get(pair);
      const ref = reference[pair];
      if (!data || !ref) continue;
      const ai = summarize(data.is.setups, data.is.trades).trades;
      const ao = summarize(data.oos.setups, data.oos.trades).trades;
      totals = { ai: totals.ai + ai, ri: totals.ri + ref.is, ao: totals.ao + ao, ro: totals.ro + ref.oos };
      lines.push(`| ${pair} | ${ai} | ${ref.is} | ${ao} | ${ref.oos} |`);
    }
    const diff = (a: number, b: number) => (b === 0 ? "—" : `${a - b >= 0 ? "+" : "−"}${Math.abs(((a - b) / b) * 100).toFixed(0)}%`);
    lines.push(
      `| **All 5** | **${totals.ai}** | **${totals.ri}** (${diff(totals.ai, totals.ri)}) | **${totals.ao}** | **${totals.ro}** (${diff(totals.ao, totals.ro)}) |`,
      "",
    );
  }

  const out = values.out ?? path.join("doc", "reports", `backtest-${info.id}.md`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`);
  console.log(`Wrote ${out}`);
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
