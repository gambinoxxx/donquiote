// Worker entry point.
//   npm run worker       — run forever on the scheduler
//   npm run worker:once  — run exactly one cycle now (even if the market is closed)
//   npm run news:once    — run the news jobs once now (calendar, headlines, pushes)
// The news jobs (worker/news) run on their own one-minute timer next to the
// price cycle, under the same lock; a failing news source never stops it.
// Only one worker may run: a Postgres advisory lock is taken first.
import "./load-env";
import { parseArgs } from "node:util";
import { getDb } from "@/lib/db/client";
import { runCycle } from "./cycle";
import { getWorkerEnv } from "./env";
import { describeError, jsonLogger } from "./log";
import { WorkerLock } from "./lock";
import { checkMigrations, migrationProblem } from "./migrations";
import { createNewsRunner, runNewsLoop } from "./news";
import { PrismaNewsStore } from "./news/store";
import { getNotifyConfig, logNotifyConfig } from "./notify-env";
import { createOandaClient } from "./oanda/client";
import { oandaPriceSource } from "./prices";
import { runScheduler } from "./scheduler";
import { PrismaStore } from "./store-prisma";

const VERSION = `donquiote@${process.env.npm_package_version ?? "dev"}`;
const log = jsonLogger;

/**
 * On a redeploy the new instance can start while the old one still holds
 * the lock (it finishes its cycle on SIGTERM, then releases). The new one
 * waits instead of exiting: up to 20 minutes (longer than one 15-minute
 * cycle), checking every 15 s. `--once` and `--news-once` never wait.
 */
export const LOCK_WAIT_MS = 20 * 60_000;
export const LOCK_RETRY_MS = 15_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { once: { type: "boolean" }, "news-once": { type: "boolean" } } });
  const env = getWorkerEnv();
  const directUrl = env.directUrl;

  // Never run against a database whose migrations are behind this code.
  const migrations = await checkMigrations();
  const problem = migrationProblem(migrations);
  if (problem) {
    log({ component: "worker", outcome: "migrations_behind", pending: migrations.pending.join(","), failed: migrations.failed.join(","), message: problem });
    return 1;
  }
  if (migrations.unknown.length > 0) {
    log({ component: "worker", outcome: "warning", message: `database has migrations this worker doesn't know (${migrations.unknown.join(", ")}): redeploy the worker` });
  }

  const stop = new AbortController();
  const lock = new WorkerLock(directUrl, log);
  const waitForLock = !values.once && !values["news-once"];
  const waitUntil = Date.now() + LOCK_WAIT_MS;
  let waitingLogged = 0;
  const earlyStop = () => stop.abort();
  process.once("SIGTERM", earlyStop);
  process.once("SIGINT", earlyStop);
  while (!(await lock.acquire())) {
    if (!waitForLock || Date.now() >= waitUntil || stop.signal.aborted) {
      log({ component: "worker", outcome: "refused", message: "another worker holds the lock; exiting" });
      return 1;
    }
    if (Date.now() - waitingLogged >= 60_000) {
      log({ component: "worker", outcome: "waiting_for_lock", message: "another worker holds the lock (a redeploy?); waiting for it to finish its cycle" });
      waitingLogged = Date.now();
    }
    await sleep(LOCK_RETRY_MS, stop.signal);
  }
  process.off("SIGTERM", earlyStop);
  process.off("SIGINT", earlyStop);
  if (stop.signal.aborted) {
    await lock.release().catch(() => {});
    return 0;
  }
  log({ component: "worker", outcome: "started", mode: values.once ? "once" : "scheduler", version: VERSION, env: env.oandaEnv });

  let takenOver = false;
  const store = new PrismaStore();
  const notifyConfig = getNotifyConfig();
  logNotifyConfig(notifyConfig, log);
  const prices = oandaPriceSource(createOandaClient({ token: env.oandaApiToken, env: env.oandaEnv }));
  const news = createNewsRunner({ store: new PrismaNewsStore(store), push: notifyConfig.channels.push, logger: log });

  // Neon may have closed the lock connection while idle: take it again.
  // Takeover is accepted (decision after Unit 7): a worker started during
  // the idle gap holds the lock now, so this one steps aside cleanly.
  // The price cycle and the news loop share one check at a time.
  let checking: Promise<boolean> | null = null;
  const guard = async (): Promise<boolean> => {
    if (takenOver) return false;
    checking ??= lock.ensure().finally(() => {
      checking = null;
    });
    if (await checking) return true;
    if (!takenOver) log({ component: "worker", outcome: "lock_taken_over", message: "lock taken by another worker, exiting" });
    takenOver = true;
    stop.abort();
    return false;
  };
  const cycle = async (now: Date) => {
    if (!(await guard())) return null;
    return runCycle({ store, prices, now, logger: log, version: VERSION, notify: notifyConfig.channels });
  };

  let signals = 0;
  const onSignal = (signal: NodeJS.Signals) => {
    signals++;
    if (signals > 1) {
      log({ component: "worker", outcome: "forced_exit", signal });
      process.exit(130);
    }
    log({ component: "worker", outcome: "stopping", signal, message: "finishing the current cycle; press again to force" });
    stop.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    if (values["news-once"]) {
      const report = await news.tick(new Date(), { force: true });
      log({ component: "news", outcome: "once", report: JSON.stringify(report), status: news.statusLine() });
      return report.calendar === "error" ? 1 : 0;
    }
    if (values.once) {
      const report = await cycle(new Date());
      if (takenOver) return 0;
      return !report || report.status === "error" ? 1 : 0;
    }
    await Promise.all([
      runScheduler({ cycle, signal: stop.signal, logger: log }),
      runNewsLoop({ runner: news, signal: stop.signal, guard, logger: log }),
    ]);
    return 0; // stopped by a signal or by a lock takeover
  } finally {
    await lock.release().catch(() => {});
    log({ component: "worker", outcome: "lock_released" });
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    log({ component: "worker", outcome: "fatal", error: describeError(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect().catch(() => {});
  });
