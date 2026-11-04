import type { Pair } from "@/lib/types";

/** Pip size per pair: 0.01 for JPY, 0.1 for gold, 0.0001 for other FX. */
export function pipSize(pair: Pair): number {
  switch (pair) {
    case "USD_JPY":
      return 0.01;
    case "XAU_USD":
      return 0.1;
    default:
      return 0.0001;
  }
}

/** Decimals used to display and store prices: 3 for JPY, 2 for gold, 5 for other FX. */
export function priceDecimals(pair: Pair): number {
  switch (pair) {
    case "USD_JPY":
      return 3;
    case "XAU_USD":
      return 2;
    default:
      return 5;
  }
}
