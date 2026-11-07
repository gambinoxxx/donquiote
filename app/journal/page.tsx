import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Journal" };

export default function JournalPage() {
  return (
    <>
      <PageHeader eyebrow="Last 7 days" title="Journal" />
      <ComingSoon
        unit={14}
        description="Taken / Skipped / Win / Loss log with win rate and net R. Feeds the risk guard."
      />
    </>
  );
}
