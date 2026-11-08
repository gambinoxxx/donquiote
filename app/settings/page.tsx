import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { ChevronRight, FlaskConical, History, List } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { InstallApp } from "@/components/install-app";
import { NotificationsControl } from "@/components/notifications-control";
import { SettingsForm } from "@/components/settings/settings-form";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAllowedUser } from "@/lib/auth";
import { getSettingsPage } from "@/lib/data";
import { formatWhen } from "@/lib/data/format";

export const metadata: Metadata = { title: "Settings" };

function LinkCard({ href, icon: Icon, title, hint }: { href: string; icon: typeof History; title: string; hint: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl border border-default bg-surface p-3.5 text-foreground no-underline">
      <Icon className="h-[22px] w-[22px] flex-none text-accent" strokeWidth={1.8} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="truncate text-xs text-muted">{hint}</p>
      </div>
      <ChevronRight className="h-[18px] w-[18px] flex-none text-muted" aria-hidden="true" />
    </Link>
  );
}

export default async function SettingsPage() {
  await connection();
  const { email } = await requireAllowedUser();
  const data = await getSettingsPage();
  const now = new Date();
  return (
    <div className="flex flex-col gap-[18px]">
      <BackLink href="/" label="Home" />
      <h1 className="-mt-2 text-[28px] leading-tight font-bold tracking-[-0.02em]">Settings</h1>

      <LinkCard
        href="/settings/history"
        icon={History}
        title="Change history"
        hint={data.lastChange ? `Last change: ${formatWhen(data.lastChange.at, now)} by ${data.lastChange.by} · undo any change` : "Undo any change"}
      />
      <LinkCard href="/strategies" icon={FlaskConical} title="Strategies" hint={`${data.liveCount} live · ${data.testCount} testing · rules and results`} />
      <LinkCard href="/watchlist" icon={List} title="Watchlist" hint={`${data.pairsOn} of ${data.pairsTotal} pairs on`} />

      {/* Keyed by version: after a save the form starts from the saved values. */}
      <SettingsForm key={data.versionId ?? "none"} initial={data.snapshot} versionId={data.versionId}>
        <NotificationsControl title="This device" />
        <InstallApp />
      </SettingsForm>

      <section aria-labelledby="access" className="flex flex-col gap-1.5">
        <h2 id="access" className="ml-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
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
    </div>
  );
}
