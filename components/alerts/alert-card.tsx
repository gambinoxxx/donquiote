import Link from "next/link";
import { formatWhen, pairLabel } from "@/lib/data/format";
import type { AlertListItem } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { LimitBadge, PaperBadge, SideBadge, StatusBadge, StrategyBadge } from "./badges";

/** One alert in the Alerts list — doc/design/alerts.html. Test signals are muted with dashed tags. */
export function AlertCard({ alert: a, now }: { alert: AlertListItem; now: Date }) {
  const faded = a.status === "EXPIRED" || a.status === "SKIPPED";
  return (
    <Link
      href={`/alerts/${a.id}`}
      className={cn(
        "flex flex-col gap-2.5 rounded-2xl border border-default bg-surface p-[14px] text-foreground no-underline active:bg-pressed",
        a.isTest && "border-dashed opacity-72",
      )}
    >
      <div className="flex items-center gap-2.5">
        <SideBadge direction={a.direction} />
        <span className={cn("min-w-0 flex-1 truncate text-base font-semibold", faded && "text-muted")}>{pairLabel(a.pair)}</span>
        {a.entryType === "LIMIT" && <LimitBadge />}
        <StrategyBadge tag={a.strategy} testPrefix={a.isTest} />
        <StatusBadge status={a.status} test={a.isTest} />
      </div>
      <p className="text-sm text-body">{a.reason}</p>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-muted">{formatWhen(a.time, now)}</p>
        {a.paper && <PaperBadge paper={a.paper} />}
      </div>
    </Link>
  );
}
