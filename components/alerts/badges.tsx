// Small shared badges (doc/design/styles.css: .side, .status, .stag, paper).
import type { Direction } from "@/lib/types";
import { formatR, formatUsd } from "@/lib/data/format";
import type { AlertStatus, PaperView, StrategyTag } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/** BUY (blue) / SELL (orange) — never red/green. */
export function SideBadge({ direction, large }: { direction: Direction; large?: boolean }) {
  return (
    <span
      className={cn(
        "flex-none rounded-lg text-center font-bold",
        large ? "w-[54px] py-1.5 text-[13px]" : "w-[50px] py-[5px] text-xs",
        direction === "BUY" ? "bg-buy text-buy" : "bg-sell text-sell",
      )}
    >
      {direction}
    </span>
  );
}

const STATUS_STYLE: Record<AlertStatus, string> = {
  READY: "bg-accent text-on-accent",
  WATCHING: "border border-strong text-soft font-semibold",
  EXPIRED: "text-muted font-semibold",
  TAKEN: "border border-accent text-accent",
  SKIPPED: "text-muted font-semibold",
};

/**
 * Ready = solid amber; Watching = outlined; Expired / Skipped = muted text.
 * A Test strategy's alert never gets the solid Ready colour (ui-context.md).
 */
export function StatusBadge({ status, test }: { status: AlertStatus; test?: boolean }) {
  const style = test && status === "READY" ? "border border-dashed border-strong text-soft font-semibold" : STATUS_STYLE[status];
  return (
    <span className={cn("flex-none rounded-[10px] px-2.5 py-[3px] text-[11px] font-bold tracking-[0.02em] whitespace-nowrap", style)}>
      {status}
    </span>
  );
}

/** Strategy code: Live = amber outline; Test = grey dashed. */
export function StrategyBadge({ tag, withName, testPrefix }: { tag: StrategyTag; withName?: boolean; testPrefix?: boolean }) {
  const live = tag.mode === "LIVE";
  return (
    <span
      className={cn(
        "inline-flex h-5 flex-none items-center rounded-md px-[7px] font-mono text-[11px] font-semibold tracking-[0.02em] whitespace-nowrap",
        live ? "border border-accent text-accent" : "border border-dashed border-strong text-muted",
      )}
      title={`${tag.name} · ${live ? "Live" : tag.mode === "OFF" ? "Off" : "Test"}`}
    >
      {!live && testPrefix ? "TEST · " : ""}
      {tag.code}
      {withName ? ` · ${tag.name.split(" · ")[0]}` : ""}
    </span>
  );
}

/** Paper result: Win blue, Loss orange, Open outlined "Tracking", others muted. R first, then dollars. */
export function PaperBadge({ paper, prefix = "Paper " }: { paper: PaperView; prefix?: string }) {
  const result =
    paper.resultR !== null && paper.pnlUsd !== null ? `${formatR(paper.resultR)} · ${formatUsd(paper.pnlUsd)}` : "";
  const base = "flex-none rounded-[10px] px-2.5 py-[3px] text-[11px] font-bold tracking-[0.02em] whitespace-nowrap";
  switch (paper.status) {
    case "OPEN":
      return <span className={cn(base, "border border-strong font-semibold text-soft")}>{prefix}· tracking</span>;
    case "WIN":
      return <span className={cn(base, "bg-buy text-buy")}>{prefix}{result}</span>;
    case "LOSS":
      return <span className={cn(base, "bg-sell text-sell")}>{prefix}{result}</span>;
    case "UNRESOLVED":
      return <span className={cn(base, "font-semibold text-muted")}>{prefix}unresolved {paper.resultR !== null ? formatR(paper.resultR) : ""}</span>;
    case "NOT_FILLED":
      return <span className={cn(base, "font-semibold text-muted")}>{prefix}not filled</span>;
  }
}

/** "Limit" marker for LIMIT entries. */
export function LimitBadge() {
  return (
    <span className="flex-none rounded-md border border-input px-1.5 font-mono text-[11px] font-semibold text-soft">LIMIT</span>
  );
}
