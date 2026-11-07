// Overview skeleton — doc/design/loading.html (layout of overview.html).
import { Wordmark } from "@/components/brand/wordmark";
import { SettingsLink } from "@/components/settings-link";
import { SkeletonBlock } from "@/components/ui/skeleton-block";
import {
  SkEyebrow,
  SkList,
  SkListRow,
  SkPadCard,
  SkRowBetween,
  SkSectionLabel,
  SkSideBadge,
  SkeletonPage,
} from "./parts";

export function AlertRowsSkeleton({ rows = 3 }: { rows?: number }) {
  const secondLine = [180, 160, 140, 170, 150];
  return (
    <SkList>
      {Array.from({ length: rows }, (_, i) => (
        <SkListRow key={i}>
          <SkSideBadge />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <SkeletonBlock width={120} height={15} className="my-[3px]" />
            <SkeletonBlock width={secondLine[i % secondLine.length]} height={12} className="my-[3px]" />
          </div>
          <SkeletonBlock width={40} height={13} />
        </SkListRow>
      ))}
    </SkList>
  );
}

export function OverviewSkeleton() {
  return (
    <SkeletonPage label="Loading overview">
      {/* Header: date eyebrow, wordmark, settings gear (the title stays real) */}
      <header className="flex items-end justify-between gap-3">
        <div>
          <SkEyebrow width={120} />
          <h1 className="mt-1 leading-tight">
            <Wordmark />
          </h1>
        </div>
        <SettingsLink />
      </header>

      {/* Risk guard card */}
      <SkeletonBlock height={74} className="w-full rounded-2xl" />

      {/* Strategy scoreboard: label + Manage, 4 two-line rows, footnote */}
      <SkPadCard className="gap-2.5">
        <SkRowBetween>
          <SkSectionLabel width={170} />
          <SkeletonBlock width={50} height={13} />
        </SkRowBetween>
        {[150, 170, 110, 100].map((width, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <SkeletonBlock width={34} height={20} className="rounded-md" />
              <div className="flex-1">
                <SkeletonBlock width={width} height={14} className="my-[3px]" />
              </div>
              <SkeletonBlock width={52} height={14} />
            </div>
            <SkeletonBlock width={190} height={12} className="my-[2px]" />
          </div>
        ))}
        <SkeletonBlock width={260} height={12} className="my-[2.5px]" />
      </SkPadCard>

      {/* Latest alerts */}
      <SkRowBetween>
        <SkeletonBlock width={110} height={17} className="my-[3.5px]" />
        <SkeletonBlock width={50} height={14} />
      </SkRowBetween>
      <AlertRowsSkeleton rows={3} />

      {/* Scanner status */}
      <SkeletonBlock width={210} height={12} className="my-[2.5px]" />
    </SkeletonPage>
  );
}
