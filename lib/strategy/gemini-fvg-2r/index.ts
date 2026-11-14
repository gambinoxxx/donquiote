// FVG Retest · 1:2 (gemini-fvg-2r). Rules: project-overview.md → Registered
// strategies. Exactly gemini-fvg's rules (direction, liquidity, sessions,
// displacement + fair value gap, limit entry valid 16 candles, stop 2 pips
// beyond the sweep extreme, one setup per pair at a time), built by the same
// createFvgRetest(); the only difference is the target: 2R instead of 3R.
//
// Note: "one setup or trade at a time" looks at this strategy's own trades,
// and a 2R target closes trades sooner than 3R, so after a win it may take a
// sweep gemini-fvg skips (still busy). Both fire on the same setups otherwise.
//
// DO NOT CHANGE RULES HERE once this strategy has produced alerts — copy it
// to a new id (architecture invariant 11).
import { createFvgRetest } from "../gemini-fvg";
import type { Strategy } from "../types";

export const REWARD_RATIO = 2;

export const geminiFvg2r: Strategy = createFvgRetest({
  id: "gemini-fvg-2r",
  name: "FVG Retest · 1:2",
  description:
    "FVG Retest with a 2R target: the same direction, liquidity, session, fair value gap, limit entry and stop rules as gemini-fvg.",
  rewardRatio: REWARD_RATIO,
});
