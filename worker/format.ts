// Display helpers for worker scripts (console output only).
import type { Pair } from "@/lib/types";
import { priceDecimals } from "@/lib/market/pip";

export const DISPLAY_TIME_ZONE = "Africa/Lagos";

/** "Wed 2026-11-04 23:45" in the given time zone. */
export function formatIn(timeZone: string, iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  })
    .format(new Date(iso))
    .replaceAll(",", "");
}

export function lagos(iso: string): string {
  return formatIn(DISPLAY_TIME_ZONE, iso);
}

export function price(pair: Pair, value: number): string {
  return value.toFixed(priceDecimals(pair));
}
