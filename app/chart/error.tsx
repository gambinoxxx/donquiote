"use client";

import { PageHeader } from "@/components/page-header";

export default function ChartError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <PageHeader eyebrow="Your levels drawn for you" title="Chart" />
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-default bg-surface p-6 text-center">
        <p className="text-muted">The chart couldn&apos;t load. Check your connection and try again.</p>
        <button type="button" onClick={reset} className="h-11 rounded-xl border border-input px-4 font-semibold">
          Retry
        </button>
      </div>
    </>
  );
}
