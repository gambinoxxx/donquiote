import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Strategies" };

export default function StrategiesPage() {
  return (
    <>
      <BackLink href="/" label="Home" />
      <PageHeader title="Strategies" />
      <ComingSoon
        unit={13}
        description="Each strategy's rules and paper results, switching between Live, Test and Off, and the 30-trade progress."
      />
    </>
  );
}
