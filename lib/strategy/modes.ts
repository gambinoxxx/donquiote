/** Mirrors the StrategyMode enum in prisma/schema.prisma. */
export type StrategyMode = "LIVE" | "TEST" | "OFF";

export interface StrategyModeRow {
  strategyId: string;
  mode: StrategyMode;
}

/**
 * Returns the id of the single LIVE strategy. Throws unless exactly one
 * strategy is LIVE (alerts must come from one rule set at a time).
 */
export function assertOneLive(modes: readonly StrategyModeRow[]): string {
  const live = modes.filter((m) => m.mode === "LIVE");
  const [only] = live;
  if (live.length !== 1 || !only) {
    const ids = live.map((m) => m.strategyId).join(", ") || "none";
    throw new Error(`Exactly one strategy must be LIVE; found ${live.length} (${ids})`);
  }
  return only.strategyId;
}
