import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { HistoryList } from "@/components/settings/history-list";
import { requireAllowedUser } from "@/lib/auth";
import { getHistoryPage } from "@/lib/data";

export const metadata: Metadata = { title: "Change history" };

export default async function SettingsHistoryPage({ searchParams }: PageProps<"/settings/history">) {
  await connection();
  await requireAllowedUser();
  const params = await searchParams;
  const cursor = typeof params.cursor === "string" ? params.cursor : null;
  const data = await getHistoryPage(cursor);
  return (
    <div className="flex flex-col gap-4">
      <BackLink href="/settings" label="Settings" />
      <header className="-mt-2">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em]">Change history</h1>
        <p className="mt-1 text-[13px] text-muted">
          Every save is kept. Restore puts those values back, and the restore is saved too, so you can undo it.
        </p>
      </header>
      {data.rows.length === 0 ? (
        <p className="rounded-2xl border border-default bg-surface p-4 text-sm text-muted">No saved versions yet.</p>
      ) : (
        <HistoryList key={`${data.versionId}:${cursor ?? ""}`} rows={data.rows} versionId={data.versionId} />
      )}
      <div className="flex justify-between gap-3">
        {cursor && (
          <Link href="/settings/history" className="text-sm font-semibold text-accent">
            Newest
          </Link>
        )}
        {data.nextCursor && (
          <Link href={`/settings/history?cursor=${data.nextCursor}`} className="ml-auto text-sm font-semibold text-accent">
            Older changes
          </Link>
        )}
      </div>
      <p className="text-center text-xs text-muted">Changes apply from the next scan.</p>
    </div>
  );
}
