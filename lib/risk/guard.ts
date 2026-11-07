// The risk guard (pure). Input: settings, DG's own journal entries and the
// time now. Paper trades never feed it (architecture invariant 12): the app
// is not connected to the broker, so it only knows what DG logs.
import type { Direction, Pair } from "@/lib/types";
import { propDayStart } from "./time";

export interface RiskSettings {
  /** Starting balance: the base for daily and STATIC drawdown maths. */
  accountSizeUsd: number;
  dailyLossLimitPct: number;
  maxDrawdownPct: number;
  warnDailyLossPct: number;
  stopDailyLossPct: number;
  warnOverallLossPct: number;
  maxTradesPerDay: number;
  dayResetTz: string;
  dayResetHour: number;
  drawdownType: "STATIC" | "TRAILING";
}

export interface RiskEntry {
  pair: Pair;
  direction: Direction;
  status: "OPEN" | "CLOSED";
  /** ISO. */
  openedAt: string;
  /** ISO; set when CLOSED. */
  closedAt: string | null;
  pnlUsd: number | null;
  riskUsd: number;
  /** ISO; soft-deleted entries never count. */
  deletedAt?: string | null;
}

export type RiskState = "cleared" | "warning" | "stopped" | "breached";

export interface UsdExposure {
  /** Open trades that are long USD / short USD. */
  long: number;
  short: number;
  /** "3 open trades all short USD", "2 long USD · 1 short USD", "No open trades". */
  text: string;
  /** 2+ open trades in the same USD direction. */
  warn: boolean;
}

export interface RiskGuardView {
  state: RiskState;
  /** "Cleared to trade", "Careful", "Done for the day", "Prop limit reached". */
  title: string;
  /** ISO: start of the prop firm's current day. */
  dayStart: string;
  startOfDayBalanceUsd: number;
  todayPnlUsd: number;
  /** Negative = down. */
  todayPct: number;
  overallPct: number;
  /** STATIC: the account size; TRAILING: the highest closed balance so far. */
  drawdownBaseUsd: number;
  openRiskUsd: number;
  /** Today's P&L if every open stop is hit. */
  worstCaseTodayPct: number;
  tradesToday: number;
  maxTradesPerDay: number;
  openTrades: number;
  usdExposure: UsdExposure;
  reasons: string[];
  limits: {
    warnDailyLossPct: number;
    stopDailyLossPct: number;
    dailyLossLimitPct: number;
    warnOverallLossPct: number;
    maxDrawdownPct: number;
  };
}

/** Trades at or above this many in the same USD direction get a warning. */
export const USD_EXPOSURE_WARN_AT = 2;

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, base: number) => (base > 0 ? round2((part / base) * 100) : 0);
const fmt = (n: number) => String(Math.abs(round2(n)));

/** Long USD = profits when the dollar rises. EUR/USD buy = short USD; USD/JPY buy = long USD. */
export function usdSide(pair: Pair, direction: Direction): "long" | "short" | null {
  const [base, quote] = pair.split("_");
  if (base === "USD") return direction === "BUY" ? "long" : "short";
  if (quote === "USD") return direction === "BUY" ? "short" : "long";
  return null;
}

export function usdExposure(open: ReadonlyArray<Pick<RiskEntry, "pair" | "direction">>): UsdExposure {
  let long = 0;
  let short = 0;
  for (const e of open) {
    const side = usdSide(e.pair, e.direction);
    if (side === "long") long++;
    else if (side === "short") short++;
  }
  const total = long + short;
  const text =
    total === 0
      ? "No open trades"
      : long === 0 || short === 0
        ? `${total} open trade${total === 1 ? "" : "s"}${total > 1 ? " all" : ""} ${long > 0 ? "long" : "short"} USD`
        : `${long} long USD · ${short} short USD`;
  return { long, short, text, warn: long >= USD_EXPOSURE_WARN_AT || short >= USD_EXPOSURE_WARN_AT };
}

const TITLES: Record<RiskState, string> = {
  cleared: "Cleared to trade",
  warning: "Careful",
  stopped: "Done for the day",
  breached: "Prop limit reached",
};

export function computeRiskGuard(settings: RiskSettings, allEntries: readonly RiskEntry[], now: Date): RiskGuardView {
  const entries = allEntries.filter((e) => !e.deletedAt);
  const dayStart = propDayStart(now, settings.dayResetTz, settings.dayResetHour).toISOString();
  const account = settings.accountSizeUsd;

  // Realised P&L in close order, for the balance and the trailing peak.
  const closed = entries
    .filter((e) => e.status === "CLOSED" && e.closedAt !== null && e.closedAt <= now.toISOString())
    .sort((a, b) => (a.closedAt as string).localeCompare(b.closedAt as string));
  let balance = account;
  let peak = account;
  let beforeToday = 0;
  let today = 0;
  for (const e of closed) {
    const pnl = e.pnlUsd ?? 0;
    balance += pnl;
    peak = Math.max(peak, balance);
    if ((e.closedAt as string) < dayStart) beforeToday += pnl;
    else today += pnl;
  }
  const startOfDay = account + beforeToday;
  const todayPct = pct(today, startOfDay);
  const drawdownBase = settings.drawdownType === "TRAILING" ? peak : account;
  const overallPct = pct(balance - drawdownBase, drawdownBase);

  const open = entries.filter((e) => e.status === "OPEN");
  const openRiskUsd = round2(open.reduce((sum, e) => sum + e.riskUsd, 0));
  const worstCaseTodayPct = pct(today - openRiskUsd, startOfDay);
  const tradesToday = entries.filter((e) => e.openedAt >= dayStart).length;
  const exposure = usdExposure(open);

  const s = settings;
  const reasons: string[] = [];
  const breached = todayPct <= -s.dailyLossLimitPct || overallPct <= -s.maxDrawdownPct;
  const stopped = todayPct <= -s.stopDailyLossPct;
  if (todayPct <= -s.dailyLossLimitPct) reasons.push(`You're down ${fmt(todayPct)}% today. Your prop firm's daily limit is ${s.dailyLossLimitPct}%.`);
  else if (stopped) reasons.push(`You're down ${fmt(todayPct)}% today. You stop for the day at ${s.stopDailyLossPct}%.`);
  else if (todayPct <= -s.warnDailyLossPct) reasons.push(`You're down ${fmt(todayPct)}% today. Your warning level is ${s.warnDailyLossPct}%.`);
  const ddWord = s.drawdownType === "TRAILING" ? "from your highest balance" : "overall";
  if (overallPct <= -s.maxDrawdownPct) reasons.push(`You're down ${fmt(overallPct)}% ${ddWord}. Your prop firm's max drawdown is ${s.maxDrawdownPct}%.`);
  else if (overallPct <= -s.warnOverallLossPct) reasons.push(`You're down ${fmt(overallPct)}% ${ddWord}. Your warning level is ${s.warnOverallLossPct}%.`);
  if (tradesToday >= s.maxTradesPerDay) reasons.push(`${tradesToday} trade${tradesToday === 1 ? "" : "s"} today. Your maximum is ${s.maxTradesPerDay}.`);
  const worstCaseWarn = !stopped && openRiskUsd > 0 && worstCaseTodayPct <= -s.stopDailyLossPct;
  if (worstCaseWarn) reasons.push(`If every open stop is hit you'd be down ${fmt(worstCaseTodayPct)}% today, past your ${s.stopDailyLossPct}% stop.`);
  if (exposure.warn) reasons.push(`${exposure.text}: they win or lose together.`);

  const warning =
    todayPct <= -s.warnDailyLossPct ||
    overallPct <= -s.warnOverallLossPct ||
    tradesToday >= s.maxTradesPerDay ||
    worstCaseTodayPct <= -s.stopDailyLossPct ||
    exposure.warn;
  const state: RiskState = breached ? "breached" : stopped ? "stopped" : warning ? "warning" : "cleared";

  return {
    state,
    title: TITLES[state],
    dayStart,
    startOfDayBalanceUsd: round2(startOfDay),
    todayPnlUsd: round2(today),
    todayPct,
    overallPct,
    drawdownBaseUsd: round2(drawdownBase),
    openRiskUsd,
    worstCaseTodayPct,
    tradesToday,
    maxTradesPerDay: s.maxTradesPerDay,
    openTrades: open.length,
    usdExposure: exposure,
    reasons,
    limits: {
      warnDailyLossPct: s.warnDailyLossPct,
      stopDailyLossPct: s.stopDailyLossPct,
      dailyLossLimitPct: s.dailyLossLimitPct,
      warnOverallLossPct: s.warnOverallLossPct,
      maxDrawdownPct: s.maxDrawdownPct,
    },
  };
}

/**
 * Would taking this trade push the worst case today past the daily limit?
 * (Used to warn in the "I took this trade" sheet; it never blocks.)
 */
export function wouldBreachDaily(view: RiskGuardView, extraRiskUsd: number): boolean {
  const worst = view.todayPnlUsd - view.openRiskUsd - extraRiskUsd;
  return pct(worst, view.startOfDayBalanceUsd) <= -view.limits.dailyLossLimitPct;
}
