// Zod validation and conversion of OANDA v20 candle responses.
import { z } from "zod";
import type { Candle } from "@/lib/types";

const priceString = z.string().regex(/^-?\d+(\.\d+)?$/, "must be a decimal string");

const oandaCandleSchema = z.object({
  complete: z.boolean(),
  time: z.string(),
  volume: z.number(),
  mid: z.object({ o: priceString, h: priceString, l: priceString, c: priceString }),
});

export const oandaCandlesResponseSchema = z.object({
  instrument: z.string(),
  granularity: z.string(),
  candles: z.array(oandaCandleSchema),
});

export type OandaCandlesResponse = z.infer<typeof oandaCandlesResponseSchema>;

/**
 * RFC3339 time from OANDA (up to nanosecond precision, e.g.
 * "2026-11-03T22:00:00.000000000Z") → ISO string with milliseconds.
 */
export function normalizeOandaTime(time: string): string {
  const trimmed = time.replace(/(\.\d{3})\d+/, "$1");
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid OANDA candle time: ${time}`);
  return date.toISOString();
}

export interface ParsedCandlesPage {
  /** Complete candles only, oldest first. */
  candles: Candle[];
  /** Number of candles in the raw response, including incomplete ones. */
  rawCount: number;
  /** True when the response included a still-forming candle (we reached the present). */
  reachedPresent: boolean;
}

/** Validates a response and returns only `complete: true` candles as our Candle type. */
export function parseCandlesResponse(json: unknown): ParsedCandlesPage {
  const response = oandaCandlesResponseSchema.parse(json);
  const candles = response.candles
    .filter((candle) => candle.complete)
    .map(
      (candle): Candle => ({
        time: normalizeOandaTime(candle.time),
        open: Number(candle.mid.o),
        high: Number(candle.mid.h),
        low: Number(candle.mid.l),
        close: Number(candle.mid.c),
      }),
    )
    .sort((a, b) => a.time.localeCompare(b.time));
  return {
    candles,
    rawCount: response.candles.length,
    reachedPresent: response.candles.some((candle) => !candle.complete),
  };
}
