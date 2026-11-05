import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Change history" };

export default function SettingsHistoryPage() {
  return (
    <>
      <BackLink href="/settings" label="Settings" />
      <PageHeader title="Change history" />
      <ComingSoon
        unit={12}
        description="Every settings save with what changed, by whom and when; Restore puts old values back (and can itself be undone)."
      />
    </>
  );
}
