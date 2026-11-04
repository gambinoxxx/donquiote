import type { OpenSetup, SetupEvent } from "./types";

/**
 * Applies events to the list of WATCHING setups (pure): SWEEP adds,
 * EXTEND moves the extreme, CONFIRM / EXPIRE / SKIP_INVALID remove.
 * Used by replays (tests, backtest) to feed the next evaluate call.
 */
export function applyEvents(
  openSetups: readonly OpenSetup[],
  events: readonly SetupEvent[],
): OpenSetup[] {
  let setups = [...openSetups];
  for (const event of events) {
    switch (event.type) {
      case "SWEEP":
        setups.push({
          dedupeKey: event.dedupeKey,
          direction: event.direction,
          sweepType: event.sweepType,
          sweepLevel: event.sweepLevel,
          sweepExtreme: event.sweepExtreme,
          sweepTime: event.sweepTime,
          bosLevel: event.bosLevel,
          expiresAt: event.expiresAt,
        });
        break;
      case "EXTEND":
        setups = setups.map((s) =>
          s.dedupeKey === event.dedupeKey ? { ...s, sweepExtreme: event.sweepExtreme } : s,
        );
        break;
      case "CONFIRM":
      case "EXPIRE":
      case "SKIP_INVALID":
        setups = setups.filter((s) => s.dedupeKey !== event.dedupeKey);
        break;
    }
  }
  return setups;
}
