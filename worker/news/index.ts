// Builds the news runner from the environment and runs its loop.
import { describeError, type Logger } from "../log";
import { sleepUntil } from "../scheduler";
import { createAiClassifier, AI_MODEL } from "./ai";
import { NewsRunner } from "./jobs";
import { fedProvider, finnhubProvider, forexFactoryProvider, whiteHouseProvider, type HeadlineProvider } from "./providers";
import type { NewsStore } from "./store";
import type { PushClient } from "@/lib/notify/push";

const nonEmpty = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : null);

export function createNewsRunner(args: { store: NewsStore; push: { client: PushClient } | null; logger: Logger; env?: NodeJS.ProcessEnv }): NewsRunner {
  const env = args.env ?? process.env;
  const headlines: HeadlineProvider[] = [];
  const skipped: string[] = [];
  const finnhubKey = nonEmpty(env.FINNHUB_API_KEY);
  if (finnhubKey) headlines.push(finnhubProvider(finnhubKey));
  else skipped.push("finnhub: off (no FINNHUB_API_KEY)");
  headlines.push(fedProvider(), whiteHouseProvider());
  const anthropicKey = nonEmpty(env.ANTHROPIC_API_KEY);
  // One log line per adapter switched off; never the values.
  for (const s of skipped) args.logger({ component: "news", outcome: "source_skipped", message: s });
  args.logger({
    component: "news",
    outcome: "ready",
    calendar: "forexfactory",
    headlines: headlines.map((h) => h.id).join(","),
    ai: anthropicKey ? AI_MODEL : "off (no ANTHROPIC_API_KEY: keyword rules only)",
    push: args.push ? "on" : "off",
  });
  return new NewsRunner({
    store: args.store,
    calendar: forexFactoryProvider(),
    headlines,
    skipped,
    ai: anthropicKey ? createAiClassifier(anthropicKey) : null,
    push: args.push,
    logger: args.logger,
  });
}

export const NEWS_TICK_MS = 60_000;

/** One tick a minute until aborted. `guard` re-checks the worker lock first. */
export async function runNewsLoop(args: { runner: NewsRunner; signal: AbortSignal; guard: () => Promise<boolean>; logger: Logger }): Promise<void> {
  const { runner, signal, guard, logger } = args;
  while (!signal.aborted) {
    try {
      if (!(await guard())) break;
      await runner.tick(new Date());
    } catch (error) {
      logger({ component: "news", outcome: "tick_crashed", error: describeError(error) });
    }
    const next = new Date(Math.floor(Date.now() / NEWS_TICK_MS) * NEWS_TICK_MS + NEWS_TICK_MS + 2_000);
    await sleepUntil(next, signal);
  }
  logger({ component: "news", outcome: "stopped" });
}
