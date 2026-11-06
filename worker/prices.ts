// Where the worker gets closed candles from. Live: OANDA. Replays and tests
// pass their own source over saved candles.
import type { Candle, Pair, Timeframe } from "@/lib/types";
import { countClosedBy } from "@/lib/strategy/replay";
import type { OandaClient } from "./oanda/client";

export interface PriceSource {
  /** Candles opened at or after `fromIso` that closed by `now`, oldest first. */
  fetchClosedSince(pair: Pair, timeframe: Timeframe, fromIso: string, now: Date): Promise<Candle[]>;
}

export function oandaPriceSource(client: OandaClient): PriceSource {
  return {
    fetchClosedSince(pair, timeframe, fromIso, now) {
      // The client returns only complete candles, oldest first, deduplicated.
      return client.fetchCandles(pair, timeframe, { from: new Date(fromIso), to: now });
    },
  };
}

/** Serves pre-loaded candles as if fetched live at `now` (replays, tests). */
export function memoryPriceSource(
  candles: Partial<Record<Pair, Partial<Record<Timeframe, readonly Candle[]>>>>,
): PriceSource {
  return {
    async fetchClosedSince(pair, timeframe, fromIso, now) {
      const list = candles[pair]?.[timeframe] ?? [];
      const end = countClosedBy(list, timeframe, now.getTime());
      let start = 0;
      let hi = end;
      while (start < hi) {
        const mid = (start + hi) >>> 1;
        if ((list[mid] as Candle).time < fromIso) start = mid + 1;
        else hi = mid;
      }
      return list.slice(start, end);
    },
  };
}
