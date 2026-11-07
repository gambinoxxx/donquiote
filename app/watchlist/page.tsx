import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";
import { requireAllowedUser } from "@/lib/auth";
import { getWatchlistView } from "@/lib/data";
import { SkeletonBlock } from "@/components/ui/skeleton-block";

export const metadata: Metadata = { title: "Watchlist" };

// Unit 2 wiring check only: plain text read from the database.
async function WatchlistFromDb() {
  await requireAllowedUser();
  const pairs = await getWatchlistView();
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {pairs.map(({ pair, enabled }) => (
        <li key={pair}>
          <Link href={`/chart?pair=${pair}`} className="font-mono text-accent">
            {pair.replace("_", "/")}
          </Link>
          : {enabled ? "on" : "off"}
        </li>
      ))}
    </ul>
  );
}

export default function WatchlistPage() {
  return (
    <>
      <PageHeader eyebrow="Watching your markets" title="Watchlist" />
      <Suspense
        fallback={
          <div aria-busy="true" aria-label="Loading watchlist" className="flex flex-col gap-1">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonBlock key={i} width={110} height={14} className="my-[3px]" />
            ))}
          </div>
        }
      >
        <WatchlistFromDb />
      </Suspense>
      <ComingSoon
        unit={13}
        description="Switch each pair on or off, see its daily / 4H bias, tap to open its chart."
      />
    </>
  );
}
