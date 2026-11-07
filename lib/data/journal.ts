// Journal, risk guard and All signals (Unit 14). Server-only.
// The risk guard reads ONLY journal entries and Settings — never alerts or
// paper results (architecture invariant 12).
import "server-only";
import { getDb } from "@/lib/db/client";
import type { JournalEntry } from "@/lib/db/generated/client";
import { computeRiskGuard, type RiskEntry, type RiskGuardView, type RiskSettings } from "@/lib/risk/guard";
import { getStrategyInfo, listStrategyInfo } from "@/lib/strategy/registry";

import { journalStats, periodStart, strategyComparison, toCsv, type JournalPeriod } from "./journal-logic";
import { alertTime, paperView, strategyTag } from "./logic";
import type { JournalEntryView, JournalPageData, SignalRow, SignalsPageData, StrategyMode, StrategyTag } from "./types";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function riskSettings(): Promise<RiskSettings & { riskPct: number }> {
  const s = await getDb().settings.findUniqueOrThrow({ where: { id: 1 } });
  return {
    accountSizeUsd: s.accountSizeUsd,
    dailyLossLimitPct: s.dailyLossLimitPct,
    maxDrawdownPct: s.maxDrawdownPct,
    warnDailyLossPct: s.warnDailyLossPct,
    stopDailyLossPct: s.stopDailyLossPct,
    warnOverallLossPct: s.warnOverallLossPct,
    maxTradesPerDay: s.maxTradesPerDay,
    dayResetTz: s.dayResetTz,
    dayResetHour: s.dayResetHour,
    drawdownType: s.drawdownType,
    riskPct: s.riskPct,
  };
}

const toRisk = (e: JournalEntry): RiskEntry => ({
  pair: e.pair,
  direction: e.direction,
  status: e.status,
  openedAt: e.openedAt.toISOString(),
  closedAt: iso(e.closedAt),
  pnlUsd: e.pnlUsd,
  riskUsd: e.riskUsd,
  deletedAt: iso(e.deletedAt),
});

async function strategyTags(): Promise<(id: string) => StrategyTag> {
  const rows = await getDb().strategyConfig.findMany({ select: { strategyId: true, mode: true } });
  const modes = new Map<string, StrategyMode>(rows.map((r) => [r.strategyId, r.mode]));
  return (id: string) =>
    strategyTag(id, modes, (x) => {
      try {
        const info = getStrategyInfo(x);
        return { id: x, code: info.code, name: info.name };
      } catch {
        return null;
      }
    });
}

/** The risk guard now: Settings + DG's own (not deleted) journal entries only. */
export async function getRiskGuard(now = new Date()): Promise<RiskGuardView> {
  const [settings, entries] = await Promise.all([
    riskSettings(),
    getDb().journalEntry.findMany({ where: { deletedAt: null } }),
  ]);
  return computeRiskGuard(settings, entries.map(toRisk), now);
}

function entryView(e: JournalEntry, tag: (id: string) => StrategyTag): JournalEntryView {
  return {
    id: e.id,
    alertId: e.alertId,
    strategy: e.strategyId ? tag(e.strategyId) : null,
    pair: e.pair,
    direction: e.direction,
    entry: e.entry,
    stop: e.stop,
    target: e.target,
    lots: e.lots,
    riskUsd: e.riskUsd,
    openedAt: e.openedAt.toISOString(),
    status: e.status,
    result: e.result,
    resultR: e.resultR,
    pnlUsd: e.pnlUsd,
    closedAt: iso(e.closedAt),
    note: e.note,
  };
}

export async function getJournal({ period }: { period: JournalPeriod }, now = new Date()): Promise<JournalPageData> {
  const db = getDb();
  const since = periodStart(period, now);
  const [settings, entries, tag] = await Promise.all([
    riskSettings(),
    db.journalEntry.findMany({ where: { deletedAt: null }, orderBy: { openedAt: "desc" } }),
    strategyTags(),
  ]);
  const guard = computeRiskGuard(settings, entries.map(toRisk), now);
  const closedInPeriod = entries
    .filter((e) => e.status === "CLOSED" && e.closedAt && (!since || e.closedAt.toISOString() >= since))
    .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0));
  return {
    period,
    guard,
    stats: journalStats(closedInPeriod, settings.accountSizeUsd),
    open: entries.filter((e) => e.status === "OPEN").map((e) => entryView(e, tag)),
    history: closedInPeriod.map((e) => entryView(e, tag)),
    defaultRiskUsd: Math.round(((settings.accountSizeUsd * settings.riskPct) / 100) * 100) / 100,
  };
}

/** Paper rows of Ready alerts whose paper trade opened in the period. */
async function paperRows(since: string | null, strategyIds?: readonly string[]) {
  return getDb().alert.findMany({
    where: {
      paperStatus: { not: null },
      ...(since && { paperOpenedAt: { gte: new Date(since) } }),
      ...(strategyIds && strategyIds.length > 0 && { strategyId: { in: [...strategyIds] } }),
    },
    orderBy: { readyAt: "desc" },
    include: { journal: { select: { id: true } } },
  });
}

/** Paper results per strategy (all registered ones) for the period, with totals. */
export async function getStrategyComparison(period: JournalPeriod, now = new Date()) {
  const [rows, tag] = await Promise.all([paperRows(periodStart(period, now)), strategyTags()]);
  const ids = listStrategyInfo().map((i) => i.id);
  const { rows: comparison, totals } = strategyComparison(
    ids,
    rows.map((r) => ({
      strategyId: r.strategyId,
      paperStatus: r.paperStatus as NonNullable<typeof r.paperStatus>,
      paperClosedAt: iso(r.paperClosedAt),
      paperResultR: r.paperResultR,
      paperPnlUsd: r.paperPnlUsd,
    })),
  );
  return { comparison: comparison.map((row) => ({ strategy: tag(row.strategyId), row })), totals };
}

export async function getSignals({ strategyIds, period }: { strategyIds?: string[]; period: JournalPeriod }, now = new Date()): Promise<SignalsPageData> {
  const [rows, tag, comparison] = await Promise.all([
    paperRows(periodStart(period, now), strategyIds),
    strategyTags(),
    getStrategyComparison(period, now),
  ]);
  const signals: SignalRow[] = rows.slice(0, 200).map((a) => {
    const strategy = tag(a.strategyId);
    return {
      id: a.id,
      pair: a.pair,
      direction: a.direction,
      strategy,
      isTest: strategy.mode !== "LIVE",
      status: a.status,
      readyAt: alertTime(a),
      entryType: a.entryType,
      paper: paperView(a),
      decision: a.status === "TAKEN" || a.journal ? "taken" : a.status === "SKIPPED" ? "skipped" : "none",
    };
  });
  return {
    period,
    comparison: comparison.comparison,
    totals: comparison.totals,
    signals,
    strategies: listStrategyInfo().map((i) => tag(i.id)),
  };
}

// --- CSV export ---------------------------------------------------------------

export async function exportCsv(kind: "trades" | "signals", period: JournalPeriod, now = new Date()): Promise<{ filename: string; csv: string }> {
  const stamp = now.toISOString().slice(0, 10);
  if (kind === "trades") {
    const { open, history } = await getJournal({ period }, now);
    const rows = [...open, ...history].map((e) => [
      e.openedAt,
      e.pair,
      e.direction,
      e.strategy?.code ?? "manual",
      e.entry,
      e.stop,
      e.target,
      e.lots,
      e.riskUsd,
      e.status,
      e.result,
      e.resultR,
      e.pnlUsd,
      e.closedAt,
      e.note,
    ]);
    return {
      filename: `donquixote-my-trades-${period}-${stamp}.csv`,
      csv: toCsv(
        ["opened_at_utc", "pair", "direction", "strategy", "entry", "stop", "target", "lots", "risk_usd", "status", "result", "result_r", "pnl_usd", "closed_at_utc", "note"],
        rows,
      ),
    };
  }
  const { signals } = await getSignals({ period }, now);
  return {
    filename: `donquixote-all-signals-${period}-${stamp}.csv`,
    csv: toCsv(
      ["ready_at_utc", "pair", "direction", "strategy", "mode", "entry_type", "status", "decision", "paper_status", "paper_r", "paper_usd", "paper_closed_at_utc"],
      signals.map((s) => [
        s.readyAt,
        s.pair,
        s.direction,
        s.strategy.code,
        s.strategy.mode,
        s.entryType,
        s.status,
        s.decision,
        s.paper?.status ?? "",
        s.paper?.resultR ?? null,
        s.paper?.pnlUsd ?? null,
        s.paper?.closedAt ?? null,
      ]),
    ),
  };
}

