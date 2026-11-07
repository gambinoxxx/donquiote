import Link from "next/link";
import { BackLink } from "@/components/back-link";

export default function AlertNotFound() {
  return (
    <div className="flex flex-col gap-4">
      <BackLink href="/alerts" label="Alerts" />
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em]">Alert not found</h1>
      <p className="text-muted">This alert doesn&apos;t exist, or the link is wrong.</p>
      <Link href="/alerts" className="flex h-[52px] items-center justify-center rounded-xl border border-input font-semibold text-foreground no-underline">
        See all alerts
      </Link>
    </div>
  );
}
