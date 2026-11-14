import type { Direction, Pair, TradeTicket } from "@/lib/types";
import { pipSize, priceDecimals } from "@/lib/market/pip";
import type { StrategySettings } from "../types";

/** Reward ratio for strategies that don't set their own (Strategy.rewardRatio). */
export const DEFAULT_REWARD_RATIO = 3;

/** Smallest tradable lot size. */
export const MIN_LOT_SIZE = 0.01;
/** Pip value per standard lot in USD for XXX/USD pairs (and gold). */
export const USD_QUOTE_PIP_VALUE = 10;
/** Pip value per standard lot for USD/JPY is this ÷ price. */
const JPY_PIP_VALUE_NUMERATOR = 1000;

const FLOAT_EPSILON = 1e-9;

function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** Rounds down to 0.01 lots, tolerating float noise (0.35 stays 0.35). */
function floorLots(lots: number): number {
  return roundTo(Math.floor(lots * 100 + FLOAT_EPSILON) / 100, 2);
}

/** USD value of one pip for one standard lot, at `price`. */
export function pipValuePerLotUsd(pair: Pair, price: number): number {
  switch (pair) {
    case "EUR_USD":
    case "GBP_USD":
    case "XAU_USD":
      return USD_QUOTE_PIP_VALUE;
    case "USD_CAD":
    case "USD_CHF":
      return USD_QUOTE_PIP_VALUE / price;
    case "USD_JPY":
      return JPY_PIP_VALUE_NUMERATOR / price;
  }
}

export interface TicketInput {
  pair: Pair;
  direction: Direction;
  /** Close of the confirming candle. */
  entry: number;
  sweepExtreme: number;
  settings: Pick<
    StrategySettings,
    "accountSizeUsd" | "riskPct" | "rewardRatio" | "stopBufferPips"
  >;
}

export type TicketResult =
  | { ok: true; ticket: TradeTicket }
  | { ok: false; reason: string };

/**
 * Trade ticket at a fixed reward ratio. Stop = sweep extreme ± buffer;
 * target = stop distance × rewardRatio; lot size risks `riskPct` of the
 * account, rounded down to 0.01. Prices rounded to the pair's decimals.
 */
export function buildTradeTicket(input: TicketInput): TicketResult {
  const { pair, direction, settings } = input;
  const pip = pipSize(pair);
  const decimals = priceDecimals(pair);
  const sign = direction === "SELL" ? 1 : -1; // which side of entry the stop sits

  const entry = roundTo(input.entry, decimals);
  const stop = roundTo(input.sweepExtreme + sign * settings.stopBufferPips * pip, decimals);
  if (sign * (stop - entry) <= 0) {
    return { ok: false, reason: "Stop is not beyond the entry" };
  }
  const stopPips = roundTo(Math.abs(entry - stop) / pip, 1);
  const targetPips = roundTo(stopPips * settings.rewardRatio, 1);
  const target = roundTo(entry - sign * targetPips * pip, decimals);
  const riskUsd = roundTo((settings.accountSizeUsd * settings.riskPct) / 100, 2);
  const lotSize = floorLots(riskUsd / (stopPips * pipValuePerLotUsd(pair, entry)));

  if (lotSize < MIN_LOT_SIZE) {
    return {
      ok: false,
      reason: `Lot size below ${MIN_LOT_SIZE}: $${riskUsd} risk over a ${stopPips}-pip stop`,
    };
  }
  return {
    ok: true,
    ticket: {
      entry,
      stop,
      target,
      stopPips,
      targetPips,
      riskPct: settings.riskPct,
      riskUsd,
      lotSize,
    },
  };
}
