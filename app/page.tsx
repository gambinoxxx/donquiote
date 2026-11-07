import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { AlertRows, HeartbeatLine, NewsBannerSlot, RiskGuardCard, Scoreboard } from "@/components/home/home-sections";
import { SettingsLink } from "@/components/settings-link";
import { requireAllowedUser } from "@/lib/auth";
import { getOverview } from "@/lib/data";
import { formatDay } from "@/lib/data/format";

export const metadata: Metadata = { title: { absolute: "Overview · Donquixote" } };

export default async function OverviewPage() {
  // Live data and the current time: always render at request time.
  await connection();
  await requireAllowedUser();
  const data = await getOverview();
  const now = new Date(data.now);
  return (
    <>
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted">{formatDay(data.now)} · Lagos</p>
          <h1 className="mt-1 leading-tight">
            <Wordmark />
            <span className="sr-only"> · Overview</span>
          </h1>
        </div>
        <SettingsLink />
      </header>

      <NewsBannerSlot />
      <RiskGuardCard risk={data.risk} />
      <Scoreboard rows={data.scoreboard} />

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">Latest alerts</h2>
        <Link href="/alerts" className="text-sm font-medium text-accent no-underline">
          See all
        </Link>
      </div>
      <AlertRows items={data.latest} now={now} empty="No alerts from Live strategies yet. They appear here as soon as the scanner finds a setup." />

      <HeartbeatLine heartbeat={data.heartbeat} />
    </>
  );
}
