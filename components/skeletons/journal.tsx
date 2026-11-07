// Journal skeleton — doc/design/journal.html (My trades tab, the default).
import { PageHeader } from "@/components/page-header";
import { SkeletonBlock } from "@/components/ui/skeleton-block";
import { SkCard, SkLines, SkList, SkListRow, SkPadCard, SkRowBetween, SkStatus, SkeletonPage } from "./parts";

export function JournalSkeleton() {
  return (
    <SkeletonPage label="Loading journal">
      <PageHeader eyebrow="Last 7 days · Lagos time" title="Journal" />

      {/* My trades / All signals tabs */}
      <SkeletonBlock height={46} className="w-full rounded-[10px]" />

      {/* Period chips */}
      <div className="flex gap-2">
        {[84, 92, 96, 72].map((width, i) => (
          <SkeletonBlock key={i} width={width} height={36} className="rounded-[18px]" />
        ))}
      </div>

      {/* Risk guard card */}
      <SkPadCard className="gap-3">
        <SkeletonBlock width={160} height={18} className="my-[3px]" />
        <SkeletonBlock height={10} className="w-full rounded-full" />
        <SkeletonBlock height={10} className="w-full rounded-full" />
        <SkLines widths={["90%", "60%"]} height={12} gap={6} />
      </SkPadCard>

      {/* Stats: Closed · Win rate · Net */}
      <div className="grid grid-cols-3 gap-2">
        {[40, 50, 30].map((width, i) => (
          <SkCard key={i} className="flex flex-col gap-1 p-3">
            <SkeletonBlock width={width} height={12} className="my-[2.5px]" />
            <SkeletonBlock width={48} height={20} className="my-[4px]" />
          </SkCard>
        ))}
      </div>

      {/* Open trade waiting for a result */}
      <SkPadCard className="gap-3">
        <SkRowBetween>
          <div className="flex flex-col gap-[3px]">
            <SkeletonBlock width={120} height={16} className="my-[3px]" />
            <SkeletonBlock width={100} height={12} className="my-[2.5px]" />
          </div>
          <SkStatus width={50} />
        </SkRowBetween>
        <div className="flex flex-col gap-2">
          <SkeletonBlock width={110} height={13} className="my-[3px]" />
          <div className="flex gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonBlock key={i} height={44} className="flex-1 rounded-lg" />
            ))}
          </div>
        </div>
      </SkPadCard>

      {/* Logged trades */}
      <SkList>
        {Array.from({ length: 4 }, (_, i) => (
          <SkListRow key={i}>
            <div className="flex flex-1 flex-col gap-[3px]">
              <SkeletonBlock width={130} height={16} className="my-[3px]" />
              <SkeletonBlock width={110} height={12} className="my-[2.5px]" />
            </div>
            <SkStatus width={40} />
          </SkListRow>
        ))}
      </SkList>

      <SkLines widths={["100%", "70%"]} height={13} gap={7} />
    </SkeletonPage>
  );
}
