// Overview skeleton — doc/design/loading.html (layout of overview.html).
import { PageHeader } from "@/components/page-header";
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

function MeterGroup({ labelWidth }: { labelWidth: number }) {
  return (
    <div className="flex flex-col gap-2">
      <SkRowBetween>
        <SkeletonBlock width={labelWidth} height={15} className="my-[3px]" />
        <SkeletonBlock width={70} height={18} className="my-[4px]" />
      </SkRowBetween>
      <SkeletonBlock height={8} className="w-full" />
      <SkRowBetween>
        <SkeletonBlock width={20} height={12} className="my-[2.5px]" />
        <SkeletonBlock width={60} height={12} className="my-[2.5px]" />
        <SkeletonBlock width={50} height={12} className="my-[2.5px]" />
      </SkRowBetween>
    </div>
  );
}

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
      <PageHeader eyebrow={<SkEyebrow width={170} />} title="Overview" action={<SettingsLink />} />

      {/* Risk guard status banner */}
      <SkeletonBlock height={70} className="w-full rounded-2xl" />

      {/* Risk guard meters */}
      <SkPadCard>
        <SkSectionLabel width={90} />
        <MeterGroup labelWidth={60} />
        <MeterGroup labelWidth={120} />
      </SkPadCard>

      {/* System score */}
      <SkPadCard className="gap-2.5">
        <SkRowBetween>
          <SkSectionLabel width={180} />
          <SkeletonBlock width={50} height={13} />
        </SkRowBetween>
        <SkeletonBlock width={110} height={26} className="my-[6px]" />
        <SkeletonBlock width={220} height={13} className="my-[3px]" />
      </SkPadCard>

      {/* Latest alerts */}
      <SkRowBetween>
        <SkeletonBlock width={110} height={17} className="my-[3.5px]" />
        <SkeletonBlock width={50} height={14} />
      </SkRowBetween>
      <AlertRowsSkeleton rows={3} />

      {/* Scanner status */}
      <SkeletonBlock width={170} height={12} className="my-[2.5px]" />
    </SkeletonPage>
  );
}
