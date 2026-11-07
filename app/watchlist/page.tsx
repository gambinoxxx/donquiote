import type { Metadata } from "next";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { WatchlistRows } from "@/components/settings/watchlist-rows";
import { requireAllowedUser } from "@/lib/auth";
import { getWatchlistPage } from "@/lib/data";

export const metadata: Metadata = { title: "Watchlist" };

export default async function WatchlistPage() {
  await connection();
  await requireAllowedUser();
  const data = await getWatchlistPage();
  return (
    <div className="flex flex-col gap-4">
      <BackLink href="/settings" label="Settings" />
      <h1 className="-mt-2 text-[28px] leading-tight font-bold tracking-[-0.02em]">Watchlist</h1>
      <WatchlistRows key={data.versionId ?? "none"} rows={data.pairs} versionId={data.versionId} />
      <p className="text-xs text-muted">A pair that is off is not scanned. Its open paper trades are still tracked until they close.</p>
    </div>
  );
}
