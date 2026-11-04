import { dgV1 } from "./dg-v1";
import type { Strategy } from "./types";

/** Every strategy version. Never remove one that has produced alerts. */
const STRATEGIES: readonly Strategy[] = [dgV1];

export function listStrategies(): readonly Strategy[] {
  return STRATEGIES;
}

/** The strategy with this id. Throws for an unknown id. */
export function getStrategy(id: string): Strategy {
  const strategy = STRATEGIES.find((s) => s.id === id);
  if (!strategy) {
    throw new Error(
      `Unknown strategy "${id}". Known: ${STRATEGIES.map((s) => s.id).join(", ")}`,
    );
  }
  return strategy;
}
