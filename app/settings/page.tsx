import { Suspense } from "react";
import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";
import { SignOutButton } from "@/components/sign-out-button";
import { AccessGroupSkeleton } from "@/components/skeletons/settings";
import { SkeletonBlock } from "@/components/ui/skeleton-block";
import { requireAllowedUser } from "@/lib/auth";
import { getSettings } from "@/lib/db/settings";

export const metadata: Metadata = { title: "Settings" };

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Unit 2 wiring check only: plain text read from the database.
async function SettingsFromDb() {
  await requireAllowedUser();
  const settings = await getSettings();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        Account size: <span className="font-mono">{usd.format(settings.accountSizeUsd)}</span>
      </p>
      <p>
        Risk per trade: <span className="font-mono">{settings.riskPct}%</span>
      </p>
    </div>
  );
}

async function AccessSection() {
  const { email } = await requireAllowedUser();
  return (
    <section aria-labelledby="access" className="flex flex-col gap-1.5">
      <h2
        id="access"
        className="ml-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase"
      >
        Access
      </h2>
      <div className="flex flex-col divide-y divide-default overflow-hidden rounded-2xl border border-default bg-surface">
        <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-1.5">
          <span>Signed in as</span>
          <span className="truncate font-mono text-[13px] text-muted">{email}</span>
        </div>
        <SignOutButton className="flex min-h-[52px] items-center justify-start px-3.5 py-1.5 text-left font-semibold text-error" />
      </div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <>
      <BackLink href="/" label="Home" />
      <PageHeader title="Settings" />
      <Suspense
        fallback={
          <div aria-busy="true" aria-label="Loading settings" className="flex flex-col gap-1">
            <SkeletonBlock width={170} height={14} className="my-[3px]" />
            <SkeletonBlock width={130} height={14} className="my-[3px]" />
          </div>
        }
      >
        <SettingsFromDb />
      </Suspense>
      <ComingSoon
        unit={11}
        description="Account size, risk %, prop firm limits, risk guard levels and notification toggles."
      />
      <Suspense fallback={<AccessGroupSkeleton />}>
        <AccessSection />
      </Suspense>
    </>
  );
}
