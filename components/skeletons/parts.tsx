// Shared skeleton building blocks. Sizes mirror doc/design/styles.css so a
// skeleton occupies exactly the space of the real component.
import type { ReactNode } from "react";
import { SkeletonBlock } from "@/components/ui/skeleton-block";
import { cn } from "@/lib/utils";

/** Container for a page or section skeleton: announces busy to screen readers. */
export function SkeletonPage({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div aria-busy="true" aria-label={label} className={cn("flex flex-col gap-4", className)}>
      {children}
    </div>
  );
}

/** `.card` — surface, 1px border, rounded-2xl. */
export function SkCard({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-default bg-surface", className)}>{children}</div>
  );
}

/** `.card.card-pad` — 16px padding, 14px gap. */
export function SkPadCard({ className, children }: { className?: string; children?: ReactNode }) {
  return <SkCard className={cn("flex flex-col gap-[14px] p-4", className)}>{children}</SkCard>;
}

/** `.card.list` — rows separated by borders. */
export function SkList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <SkCard className={cn("flex flex-col divide-y divide-default overflow-hidden", className)}>
      {children}
    </SkCard>
  );
}

/** `.list-row` — 14px padding, 12px gap, min 56px. */
export function SkListRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex min-h-14 items-center gap-3 p-[14px]", className)}>{children}</div>;
}

/** `.row-between` */
export function SkRowBetween({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex items-center justify-between gap-3", className)}>{children}</div>;
}

/** Eyebrow text line (13px) above a page title. */
export function SkEyebrow({ width }: { width: number }) {
  return <SkeletonBlock width={width} height={13} className="my-[2.5px]" />;
}

/** `.section-label` (12px uppercase). */
export function SkSectionLabel({ width }: { width: number }) {
  return <SkeletonBlock width={width} height={12} className="my-[2.5px]" />;
}

/** `.side` BUY/SELL badge. */
export function SkSideBadge() {
  return <SkeletonBlock width={50} height={26} className="rounded-lg" />;
}

/** `.status` pill. */
export function SkStatus({ width = 64 }: { width?: number }) {
  return <SkeletonBlock width={width} height={20} className="rounded-[10px]" />;
}

/** `.switch` 52 × 32. */
export function SkSwitch() {
  return <SkeletonBlock width={52} height={32} className="rounded-2xl" />;
}

/** `.chip` 36px tall. */
export function SkChip({ width }: { width: number }) {
  return <SkeletonBlock width={width} height={36} className="rounded-[18px]" />;
}

/** `.btn` 52px main button. */
export function SkButton({ className }: { className?: string }) {
  return <SkeletonBlock height={52} className={cn("w-full rounded-xl", className)} />;
}

/** Text lines (each block sits in a line box of `lineHeight`). */
export function SkLines({
  widths,
  height = 14,
  gap = 6,
}: {
  widths: ReadonlyArray<number | string>;
  height?: number;
  gap?: number;
}) {
  return (
    <div className="flex flex-col" style={{ gap }}>
      {widths.map((width, i) => (
        <SkeletonBlock key={i} width={width} height={height} />
      ))}
    </div>
  );
}
