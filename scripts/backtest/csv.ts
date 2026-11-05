import { readFile } from "node:fs/promises";
import type { Candle } from "@/lib/types";

/** Parses a `time,open,high,low,close` CSV written by data:download. */
export function parseCandlesCsv(text: string, label: string): Candle[] {
  const lines = text.trim().split("\n");
  if (lines[0]?.trim() !== "time,open,high,low,close") {
    throw new Error(`${label}: unexpected header "${lines[0] ?? ""}"`);
  }
  return lines.slice(1).map((line, i) => {
    const [time, open, high, low, close] = line.split(",");
    const candle = {
      time: time ?? "",
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
    };
    if (
      Number.isNaN(Date.parse(candle.time)) ||
      [candle.open, candle.high, candle.low, candle.close].some((n) => !Number.isFinite(n))
    ) {
      throw new Error(`${label}: bad row ${i + 2}: ${line}`);
    }
    return candle;
  });
}

export async function loadCandlesCsv(file: string): Promise<Candle[]> {
  return parseCandlesCsv(await readFile(file, "utf8"), file);
}
