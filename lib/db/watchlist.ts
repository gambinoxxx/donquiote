import { getDb } from "./client";
import type { WatchlistPair } from "./generated/client";

/** All watchlist pairs, in display order. */
export async function getWatchlist(): Promise<WatchlistPair[]> {
  return getDb().watchlistPair.findMany({ orderBy: { sortOrder: "asc" } });
}
