import { Suspense } from "react";
import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";
import { requireAllowedUser } from "@/lib/auth";
import { getWatchlist } from "@/lib/db/watchlist";

export const metadata: Metadata = { title: "Watchlist" };

// Unit 2 wiring check only: plain text read from the database.
async function WatchlistFromDb() {
  await requireAllowedUser();
  const pairs = await getWatchlist();
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {pairs.map(({ pair, enabled }) => (
        <li key={pair}>
          <span className="font-mono">{pair.replace("_", "/")}</span>: {enabled ? "on" : "off"}
        </li>
      ))}
    </ul>
  );
}

export default function WatchlistPage() {
  return (
    <>
      <PageHeader eyebrow="Watching your markets" title="Watchlist" />
      <Suspense fallback={<p className="text-sm text-muted">Loading watchlist…</p>}>
        <WatchlistFromDb />
      </Suspense>
      <ComingSoon
        unit={11}
        description="Switch each pair on or off, see its daily / 4H bias, tap to open its chart."
      />
    </>
  );
}
