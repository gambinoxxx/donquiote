// Worker entry point.
//   npm run worker       — run forever on the scheduler
//   npm run worker:once  — run exactly one cycle now (even if the market is closed)
// Only one worker may run: a Postgres advisory lock is taken first.
import "./load-env";
import { parseArgs } from "node:util";
import { getDb } from "@/lib/db/client";
import { runCycle } from "./cycle";
import { getWorkerEnv } from "./env";
import { describeError, jsonLogger } from "./log";
import { WorkerLock } from "./lock";
import { createOandaClient } from "./oanda/client";
import { oandaPriceSource } from "./prices";
import { runScheduler } from "./scheduler";
import { PrismaStore } from "./store-prisma";

const VERSION = `donquiote@${process.env.npm_package_version ?? "dev"}`;
const log = jsonLogger;

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { once: { type: "boolean" } } });
  const env = getWorkerEnv();
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    throw new Error("DIRECT_URL is required for the worker lock (see .env.example)");
  }

  const stop = new AbortController();
  const lock = new WorkerLock(directUrl, log);
  if (!(await lock.acquire())) {
    log({ component: "worker", outcome: "refused", message: "another worker holds the lock; exiting" });
    return 1;
  }
  log({ component: "worker", outcome: "started", mode: values.once ? "once" : "scheduler", version: VERSION, env: env.oandaEnv });

  const store = new PrismaStore();
  const prices = oandaPriceSource(createOandaClient({ token: env.oandaApiToken, env: env.oandaEnv }));
  const cycle = async (now: Date) => {
    // Neon may have closed the lock connection while idle: take it again.
    if (!(await lock.ensure())) {
      log({ component: "worker", outcome: "lock_taken_over", message: "another worker now holds the lock; stopping" });
      process.exitCode = 1;
      stop.abort();
      return null;
    }
    return runCycle({ store, prices, now, logger: log, version: VERSION });
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
    if (values.once) {
      const report = await cycle(new Date());
      return !report || report.status === "error" ? 1 : 0;
    }
    await runScheduler({ cycle, signal: stop.signal, logger: log });
    return typeof process.exitCode === "number" ? process.exitCode : 0;
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
