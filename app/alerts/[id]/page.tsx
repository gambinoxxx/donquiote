import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Alert" };

export default function AlertDetailPage() {
  return (
    <>
      <BackLink href="/alerts" label="Alerts" />
      <PageHeader title="Alert" />
      <ComingSoon
        unit={9}
        description="Mini chart with sweep, entry, stop and target; rule checklist; trade ticket; Ask Claude; Taken / Skip."
      />
    </>
  );
}
