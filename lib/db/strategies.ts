import type { StrategyModeRow } from "@/lib/strategy/modes";
import { getDb } from "./client";

/** Every StrategyConfig row (strategy id + LIVE / TEST / OFF). */
export async function getStrategyModes(): Promise<StrategyModeRow[]> {
  return getDb().strategyConfig.findMany({
    select: { strategyId: true, mode: true },
    orderBy: { strategyId: "asc" },
  });
}
