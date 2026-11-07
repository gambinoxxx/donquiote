// Alerts list and alert detail skeletons — doc/design/alerts.html, alert-detail.html.
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { SkeletonBlock } from "@/components/ui/skeleton-block";
import {
  SkButton,
  SkCard,
  SkChip,
  SkEyebrow,
  SkLines,
  SkPadCard,
  SkRowBetween,
  SkSectionLabel,
  SkSideBadge,
  SkStatus,
  SkSwitch,
  SkeletonPage,
} from "./parts";

/** Alert cards (alerts.html #list). */
export function AlertCardsSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: cards }, (_, i) => (
        <SkCard key={i} className="flex flex-col gap-2.5 p-[14px]">
          <div className="flex items-center gap-2.5">
            <SkSideBadge />
            <div className="flex-1">
              <SkeletonBlock width={90} height={16} className="my-[3.5px]" />
            </div>
            <SkStatus />
          </div>
          <SkLines widths={["100%", i % 2 === 0 ? "72%" : "55%"]} height={14} gap={6} />
          <SkeletonBlock width={140} height={12} className="my-[2.5px]" />
        </SkCard>
      ))}
    </div>
  );
}

export function AlertsSkeleton() {
  return (
    <SkeletonPage label="Loading alerts">
      <PageHeader eyebrow={<SkEyebrow width={150} />} title="Alerts" />
      <div className="flex flex-wrap gap-2">
        <SkChip width={52} />
        <SkChip width={70} />
        <SkChip width={92} />
        <SkChip width={84} />
        <SkChip width={84} />
      </div>
      {/* Show test signals */}
      <SkCard className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <div className="flex flex-col gap-1">
          <SkeletonBlock width={120} height={14} className="my-[2px]" />
          <SkeletonBlock width={210} height={12} className="my-[1px]" />
        </div>
        <SkSwitch />
      </SkCard>
      <AlertCardsSkeleton cards={3} />
    </SkeletonPage>
  );
}

function TicketCell() {
  return <SkeletonBlock height={64} className="w-full rounded-[10px]" />;
}

export function AlertDetailSkeleton() {
  return (
    <SkeletonPage label="Loading alert" className="gap-[14px]">
      <BackLink href="/alerts" label="Alerts" />

      {/* Direction · pair · status (pair is data, so the title is a block here) */}
      <header className="flex items-center gap-2.5">
        <SkeletonBlock width={54} height={30} className="rounded-lg" />
        <div className="flex-1">
          <SkeletonBlock width={120} height={26} className="my-[2px]" />
        </div>
        <SkStatus />
      </header>
      <SkeletonBlock width={240} height={12} className="-mt-1.5 mb-[2.5px]" />
      {/* Seen by */}
      <div className="-mt-1 flex items-center gap-1.5">
        <SkeletonBlock width={46} height={12} />
        <SkeletonBlock width={90} height={20} className="rounded-md" />
      </div>

      {/* Mini chart + "Open full chart" */}
      <SkCard className="p-2.5">
        <SkeletonBlock className="aspect-[338/170] w-full" />
        <div className="flex min-h-11 items-center justify-center">
          <SkeletonBlock width={120} height={14} />
        </div>
      </SkCard>

      {/* Your rules checklist */}
      <SkPadCard className="gap-2.5">
        <SkSectionLabel width={80} />
        {[150, 140, 210, 200, 230].map((width, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <SkeletonBlock width={18} height={18} className="rounded-full" />
            <SkeletonBlock width={width} height={14} className="my-[3px]" />
          </div>
        ))}
      </SkPadCard>

      {/* Trade ticket */}
      <SkPadCard className="gap-2.5">
        <SkSectionLabel width={90} />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <TicketCell key={i} />
          ))}
        </div>
      </SkPadCard>

      {/* Paper trade */}
      <SkPadCard className="gap-2.5">
        <SkRowBetween>
          <SkSectionLabel width={90} />
          <SkStatus width={72} />
        </SkRowBetween>
        <SkLines widths={["100%", "92%", "40%"]} height={14} gap={7} />
        <SkeletonBlock width={230} height={12} className="my-[2.5px]" />
      </SkPadCard>

      {/* Ask Claude */}
      <SkPadCard className="gap-3">
        <div className="flex flex-col gap-1">
          <SkeletonBlock width={170} height={16} className="my-[3px]" />
          <SkLines widths={["100%", "60%"]} height={13} gap={7} />
        </div>
        <SkButton />
      </SkPadCard>

      {/* Skip / I took this trade */}
      <div className="flex gap-2.5">
        <SkButton className="flex-1" />
        <SkButton className="flex-[2]" />
      </div>
    </SkeletonPage>
  );
}
