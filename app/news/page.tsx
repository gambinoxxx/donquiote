import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "News" };

export default function NewsPage() {
  return (
    <>
      <PageHeader eyebrow="Red news and market-moving headlines" title="News" />
      <ComingSoon
        unit={15}
        description="High-impact calendar events for your currencies, market-moving headlines, and warnings on alerts near red news."
      />
    </>
  );
}
