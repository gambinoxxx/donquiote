// Pure: the push payload and the email for a READY alert. Prices come from
// the alert, formatted with the pair's precision (5 decimals, 3 for JPY).
import type { Direction, EntryType, Pair } from "@/lib/types";
import { priceDecimals } from "@/lib/market/pip";
import { getStrategyInfo } from "@/lib/strategy/registry";

export const SAFETY_LINE = "This app never places trades. Check the chart before entering.";

/** What the notification needs from an alert. */
export interface NotifyContent {
  id: string;
  pair: Pair;
  direction: Direction;
  /** Strategies in the group, first one first. */
  strategyIds: readonly string[];
  entry: number;
  stop: number;
  target: number;
  lotSize: number;
  riskUsd: number;
  sweepType: string;
  sweepLevel: number;
  /** Break level (BOS); for gemini-fvg the swept level. */
  bosLevel: number | null;
  entryType: EntryType;
  /** ISO, UTC. */
  readyAt: string;
  /** ISO, UTC; LIMIT only. */
  entryValidUntil: string | null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path of the alert in the app. */
  url: string;
  /** The group id: a later notification with the same tag replaces this one. */
  tag: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export const pairLabel = (pair: Pair) => pair.replace("_", "/");
export const formatPrice = (pair: Pair, value: number) => value.toFixed(priceDecimals(pair));

function strategyLabel(id: string, field: "code" | "name"): string {
  try {
    return getStrategyInfo(id)[field];
  } catch {
    return id; // an id no longer registered still shows something
  }
}

/** "4h", "45m", "1h 30m". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function notificationTitle(c: Pick<NotifyContent, "pair" | "direction">): string {
  return `${pairLabel(c.pair)} ${c.direction} · Ready`;
}

/** "Entry 1.11800 · SL …" or, for a limit entry, "Limit 1.11800 (valid 4h) · SL …". */
function entryText(c: NotifyContent): string {
  const price = formatPrice(c.pair, c.entry);
  if (c.entryType === "LIMIT" && c.entryValidUntil) {
    return `Limit ${price} (valid ${formatDuration(Date.parse(c.entryValidUntil) - Date.parse(c.readyAt))})`;
  }
  return `Entry ${price}`;
}

export function pushPayload(c: NotifyContent, groupId: string): PushPayload {
  const codes = c.strategyIds.map((id) => strategyLabel(id, "code")).join("+");
  return {
    title: notificationTitle(c),
    body: [
      entryText(c),
      `SL ${formatPrice(c.pair, c.stop)}`,
      `TP ${formatPrice(c.pair, c.target)}`,
      `${c.lotSize.toFixed(2)} lots`,
      codes,
    ].join(" · "),
    url: `/alerts/${c.id}`,
    tag: groupId,
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function emailContent(c: NotifyContent, appUrl: string): EmailContent {
  const p = (v: number) => formatPrice(c.pair, v);
  const link = `${appUrl.replace(/\/$/, "")}/alerts/${c.id}`;
  const strategies = c.strategyIds.map((id) => strategyLabel(id, "name")).join(", ");
  const rows: Array<[string, string]> = [
    ["Pair", `${pairLabel(c.pair)} ${c.direction}`],
    ["Strategy", strategies],
    [c.entryType === "LIMIT" ? "Limit entry" : "Entry", entryText(c).replace(/^(Entry|Limit) /, "")],
    ["Stop", p(c.stop)],
    ["Target", p(c.target)],
    ["Lot size", `${c.lotSize.toFixed(2)} lots`],
    ["Risk", `$${c.riskUsd.toFixed(2)}`],
    ["Swept", `${c.sweepType} ${p(c.sweepLevel)}`],
    ["Break level", c.bosLevel === null ? "—" : p(c.bosLevel)],
  ];
  const text = [
    notificationTitle(c),
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `Open the alert: ${link}`,
    "",
    SAFETY_LINE,
  ].join("\n");
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0E1116;color:#E8EAED;font-family:Arial,Helvetica,sans-serif">
  <h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(notificationTitle(c))}</h1>
  <table style="border-collapse:collapse;font-size:15px">
${rows
  .map(
    ([k, v]) =>
      `    <tr><td style="padding:4px 16px 4px 0;color:#9AA3AE">${escapeHtml(k)}</td><td style="padding:4px 0;font-family:Menlo,Consolas,monospace">${escapeHtml(v)}</td></tr>`,
  )
  .join("\n")}
  </table>
  <p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#F5B544;color:#1A1406;font-weight:bold;text-decoration:none">Open the alert</a></p>
  <p style="margin:0;color:#9AA3AE;font-size:13px">${escapeHtml(SAFETY_LINE)}</p>
</body></html>`;
  return { subject: notificationTitle(c), html, text };
}
