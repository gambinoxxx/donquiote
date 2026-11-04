import type { Metadata } from "next";
import Link from "next/link";
import { Settings } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: { absolute: "Overview · DG Signals" } };

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Today · market session"
        title="Overview"
        action={
          <Link
            href="/settings"
            aria-label="Settings"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-foreground"
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </Link>
        }
      />
      <ComingSoon
        unit={9}
        description="Risk guard status, today's trades, latest alerts and scanner online/offline."
      />
    </>
  );
}
