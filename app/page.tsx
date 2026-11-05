import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";
import { SettingsLink } from "@/components/settings-link";

export const metadata: Metadata = { title: { absolute: "Overview · Donquixote" } };

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Today · market session"
        title="Overview"
        action={<SettingsLink />}
      />
      <ComingSoon
        unit={9}
        description="Risk guard status, today's trades, latest alerts and scanner online/offline."
      />
    </>
  );
}
