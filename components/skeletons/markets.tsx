// Chart and Watchlist skeletons — doc/design/chart.html, watchlist.html.
import { PageHeader } from "@/components/page-header";
import { SkeletonBlock } from "@/components/ui/skeleton-block";
import {
  SkButton,
  SkCard,
  SkChip,
  SkEyebrow,
  SkList,
  SkListRow,
  SkRowBetween,
  SkSwitch,
  SkeletonPage,
} from "./parts";

export function ChartSkeleton() {
  return (
    <SkeletonPage label="Loading chart" className="gap-[14px]">
      <PageHeader eyebrow="Your levels drawn for you" title="Chart" />

      {/* Pair chips (scroll sideways) */}
      <div className="flex gap-2 overflow-hidden">
        {[82, 82, 80, 82, 82].map((width, i) => (
          <SkChip key={i} width={width} />
        ))}
      </div>

      {/* Last price + bias · D / 4H / 15m */}
      <SkRowBetween>
        <div className="flex flex-col gap-1">
          <SkeletonBlock width={110} height={22} className="my-[4px]" />
          <SkeletonBlock width={140} height={13} className="my-[3px]" />
        </div>
        <SkeletonBlock width={170} height={40} className="rounded-[10px]" />
      </SkRowBetween>

      {/* Chart card + legend */}
      <SkCard className="px-1 pt-2 pb-2.5">
        <SkeletonBlock className="aspect-[360/320] w-full" />
        <div className="flex flex-wrap gap-x-3.5 gap-y-2 px-2.5 pt-1.5">
          {[110, 100, 50, 44, 54].map((width, i) => (
            <SkeletonBlock key={i} width={width} height={12} className="my-[2.5px]" />
          ))}
        </div>
      </SkCard>

      {/* Level toggles */}
      <SkList>
        {[170, 130, 140].map((width, i) => (
          <div key={i} className="flex min-h-12 items-center justify-between gap-3 px-[14px]">
            <SkeletonBlock width={width} height={15} />
            <SkSwitch />
          </div>
        ))}
      </SkList>

      <SkButton />
      <SkeletonBlock width={260} height={12} className="mx-auto my-[2.5px]" />
    </SkeletonPage>
  );
}

/** The watchlist rows card on its own (also a Suspense fallback). */
export function WatchlistRowsSkeleton({ rows = 6 }: { rows?: number }) {
  const bias = [170, 150, 180, 150, 170, 90];
  return (
    <SkList>
      {Array.from({ length: rows }, (_, i) => (
        <SkListRow key={i}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <SkeletonBlock width={i === rows - 1 ? 120 : 80} height={16} className="my-[3.5px]" />
            <SkeletonBlock width={bias[i % bias.length]} height={13} className="my-[3px]" />
          </div>
          <SkSwitch />
        </SkListRow>
      ))}
    </SkList>
  );
}

export function WatchlistSkeleton() {
  return (
    <SkeletonPage label="Loading watchlist">
      <PageHeader eyebrow={<SkEyebrow width={160} />} title="Watchlist" />
      {/* USD exposure notice */}
      <SkeletonBlock height={63} className="w-full rounded-xl" />
      <WatchlistRowsSkeleton rows={6} />
      <SkeletonBlock width={280} height={13} className="my-[3px]" />
    </SkeletonPage>
  );
}
