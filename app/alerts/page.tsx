import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <>
      <PageHeader eyebrow="Your setup on 5 pairs" title="Alerts" />
      <ComingSoon
        unit={9}
        description="Alerts list with filters: All, Ready, Watching, Expired."
      />
    </>
  );
}
