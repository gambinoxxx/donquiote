/** Mirrors the StrategyMode enum in prisma/schema.prisma. */
export type StrategyMode = "LIVE" | "TEST" | "OFF";

export interface StrategyModeRow {
  strategyId: string;
  mode: StrategyMode;
}

/**
 * Ids of the LIVE strategies. Throws unless at least one strategy is LIVE
 * (architecture invariant 10: several may be LIVE; never none).
 */
export function assertSomeLive(modes: readonly StrategyModeRow[]): string[] {
  const live = modes.filter((m) => m.mode === "LIVE").map((m) => m.strategyId);
  if (live.length === 0) {
    throw new Error("At least one strategy must be LIVE; found none");
  }
  return live;
}

/** Strategies the worker runs: LIVE and TEST (OFF is skipped), LIVE first. */
export function activeStrategies(modes: readonly StrategyModeRow[]): StrategyModeRow[] {
  const rank: Record<StrategyMode, number> = { LIVE: 0, TEST: 1, OFF: 2 };
  return modes
    .filter((m) => m.mode !== "OFF")
    .sort((a, b) => rank[a.mode] - rank[b.mode] || a.strategyId.localeCompare(b.strategyId));
}
