// Lot size suggestion for a trade logged by hand: the same maths as the
// trade ticket (risk ÷ (stop pips × pip value per lot), rounded down to 0.01).
import type { Pair } from "@/lib/types";
import { pipSize } from "@/lib/market/pip";
import { MIN_LOT_SIZE, pipValuePerLotUsd } from "@/lib/strategy/shared/ticket";

export function suggestLots(pair: Pair, entry: number, stop: number, riskUsd: number): number | null {
  if (!(entry > 0) || !(stop > 0) || !(riskUsd > 0) || entry === stop) return null;
  const stopPips = Math.abs(entry - stop) / pipSize(pair);
  const lots = Math.floor((riskUsd / (stopPips * pipValuePerLotUsd(pair, entry))) * 100 + 1e-9) / 100;
  return lots >= MIN_LOT_SIZE ? lots : null;
}
