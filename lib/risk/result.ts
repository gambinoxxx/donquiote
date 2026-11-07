// A journal result → money. Pure.
//   WIN       = riskUsd × R (R defaults to 3, editable)
//   LOSS      = −riskUsd
//   BREAKEVEN = 0
//   CUSTOM    = the USD DG enters (may include fees)
// resultR = pnlUsd ÷ riskUsd.

export type JournalResult = "WIN" | "LOSS" | "BREAKEVEN" | "CUSTOM";
export const DEFAULT_WIN_R = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function resultToPnl(
  result: JournalResult,
  riskUsd: number,
  input: { r?: number; usd?: number } = {},
): { pnlUsd: number; resultR: number } {
  if (!(riskUsd > 0)) throw new RangeError("riskUsd must be above 0");
  let pnlUsd: number;
  switch (result) {
    case "WIN": {
      const r = input.r ?? DEFAULT_WIN_R;
      if (!(r > 0)) throw new RangeError("A win needs R above 0");
      pnlUsd = riskUsd * r;
      break;
    }
    case "LOSS":
      pnlUsd = -riskUsd;
      break;
    case "BREAKEVEN":
      pnlUsd = 0;
      break;
    case "CUSTOM":
      if (input.usd === undefined || !Number.isFinite(input.usd)) throw new RangeError("A custom result needs a USD amount");
      pnlUsd = input.usd;
      break;
  }
  return { pnlUsd: round2(pnlUsd), resultR: round2(pnlUsd / riskUsd) };
}
