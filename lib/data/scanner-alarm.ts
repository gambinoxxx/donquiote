// "Scanner stopped" alarm (Unit 16), run by GET /api/cron/scanner-check
// every 15 minutes (cron-job.org). Pure decision + an orchestrator with
// injected storage and senders, so every case is tested without a database.
//
// Stale = the market is open now AND was open 45 minutes ago (no false alarm
// right after the Sunday open, before the first cycle) AND the last fully OK
// scan (heartbeat lastOkAt) is older than 45 minutes (same limit as Home's
// "Scanner stopped"). One message per outage: raising and recovering are
// guarded single-row updates (claim), so overlapping checks send once.
// The alarm ignores the alert toggles in Settings: it is about the app itself.
import { timingSafeEqual } from "node:crypto";
import { isMarketOpen } from "@/lib/market/time";
import type { EmailContent, PushPayload } from "@/lib/notify/format";
import { formatClock, formatWhen } from "./format";
import { SCANNER_STOPPED_AFTER_MS } from "./logic";

export interface HeartbeatFacts {
  lastScanAt: string | null;
  lastOkAt: string | null;
  status: string;
  message: string | null;
}

export interface AlarmState {
  /** Set while an outage is open (its message went out). */
  stoppedAt: string | null;
  lastOkAtWhenStopped: string | null;
}

export type AlarmDecision =
  | { action: "none"; state: "ok" | "stopped" | "market_closed"; reason: string }
  | { action: "raise"; reason: string; message: AlarmMessage }
  | { action: "recover"; reason: string; message: AlarmMessage };

export interface AlarmMessage {
  push: PushPayload;
  email: EmailContent;
}

const MIN = 60_000;

/** Bearer check, constant time. A missing secret never authorizes. */
export function isAuthorized(header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const m = /^Bearer (.+)$/.exec(header.trim());
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function message(title: string, lines: string[], appUrl: string, tag: string): AlarmMessage {
  const text = [...lines, "", `Open the app: ${appUrl}`, "What to do: doc/runbook.md → Scanner stopped."].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5"><h2 style="margin:0 0 8px">${escape(title)}</h2>${lines
    .map((l) => `<p style="margin:0 0 8px">${escape(l)}</p>`)
    .join("")}<p><a href="${escape(appUrl)}">Open Donquixote</a></p><p style="color:#666;font-size:13px">What to do: doc/runbook.md → Scanner stopped.</p></div>`;
  return { push: { title, body: lines.join(" "), url: "/", tag }, email: { subject: title, html, text } };
}

export function decideScannerAlarm(args: { now: Date; heartbeat: HeartbeatFacts | null; alarm: AlarmState; appUrl: string }): AlarmDecision {
  const { now, heartbeat, alarm, appUrl } = args;
  const lastOk = heartbeat?.lastOkAt ?? null;

  // Recovery first: a newer OK scan than the one the alarm was raised on.
  if (alarm.stoppedAt) {
    const recovered = lastOk !== null && (alarm.lastOkAtWhenStopped === null || Date.parse(lastOk) > Date.parse(alarm.lastOkAtWhenStopped));
    if (recovered) {
      const down = Math.round((Date.parse(lastOk) - Date.parse(alarm.lastOkAtWhenStopped ?? alarm.stoppedAt)) / MIN);
      return {
        action: "recover",
        reason: "a new OK scan since the alarm",
        message: message(
          `Scanner back at ${formatClock(lastOk)}`,
          [`The scanner is running again (last OK scan ${formatClock(lastOk)} Lagos${down > 0 ? `, about ${down} min after the previous one` : ""}).`, "Alerts are flowing again."],
          appUrl,
          "scanner-alarm",
        ),
      };
    }
    return { action: "none", state: "stopped", reason: "outage already reported" };
  }

  if (!isMarketOpen(now) || !isMarketOpen(new Date(now.getTime() - SCANNER_STOPPED_AFTER_MS))) {
    return { action: "none", state: "market_closed", reason: "market closed (or opened less than 45 min ago)" };
  }
  const age = lastOk === null ? Number.POSITIVE_INFINITY : now.getTime() - Date.parse(lastOk);
  if (age <= SCANNER_STOPPED_AFTER_MS) return { action: "none", state: "ok", reason: "last OK scan is recent" };

  const since = lastOk ? `${formatClock(lastOk)}` : "unknown";
  const stillScanning = heartbeat?.lastScanAt && now.getTime() - Date.parse(heartbeat.lastScanAt) <= SCANNER_STOPPED_AFTER_MS;
  const lines = [
    lastOk
      ? `No successful scan since ${since} Lagos (${formatWhen(lastOk, now)}) while the market is open.`
      : "The scanner has never completed a successful scan, and the market is open.",
    stillScanning
      ? `It is still running but failing: ${heartbeat?.status ?? "error"}${heartbeat?.message ? ` — ${heartbeat.message.slice(0, 160)}` : ""}.`
      : "No new alerts will arrive until it is back. Check the Railway worker.",
  ];
  return {
    action: "raise",
    reason: `last OK scan ${lastOk ? `${Math.round(age / MIN)} min ago` : "never"}`,
    message: message(stillScanning ? `Scanner failing since ${since}` : `Scanner stopped at ${since}`, lines, appUrl, "scanner-alarm"),
  };
}

export interface ScannerCheckDeps {
  loadHeartbeat(): Promise<HeartbeatFacts | null>;
  loadAlarm(): Promise<AlarmState>;
  /** Sets stoppedAt only if no outage is open. True = this call won and must send. */
  claimRaise(atIso: string, lastOkAt: string | null): Promise<boolean>;
  /** Clears stoppedAt only if it is still `stoppedAt`. True = this call won. */
  claimRecover(stoppedAt: string, atIso: string): Promise<boolean>;
  markChecked(atIso: string): Promise<void>;
  /** Push to every device and email to every allowed address. Never throws. */
  send(message: AlarmMessage): Promise<{ push: number; email: number; problems: string[] }>;
  appUrl: string;
}

export interface ScannerCheckResult {
  action: AlarmDecision["action"];
  state: "ok" | "stopped" | "market_closed" | "raised" | "recovered";
  reason: string;
  sent: { push: number; email: number } | null;
  problems: string[];
}

export async function runScannerCheck(now: Date, deps: ScannerCheckDeps): Promise<ScannerCheckResult> {
  const at = now.toISOString();
  const [heartbeat, alarm] = await Promise.all([deps.loadHeartbeat(), deps.loadAlarm()]);
  const decision = decideScannerAlarm({ now, heartbeat, alarm, appUrl: deps.appUrl });
  await deps.markChecked(at);
  if (decision.action === "none") return { action: "none", state: decision.state, reason: decision.reason, sent: null, problems: [] };

  const won =
    decision.action === "raise"
      ? await deps.claimRaise(at, heartbeat?.lastOkAt ?? null)
      : await deps.claimRecover(alarm.stoppedAt!, at);
  if (!won) return { action: "none", state: decision.action === "raise" ? "stopped" : "ok", reason: "another check already sent it", sent: null, problems: [] };

  const result = await deps.send(decision.message);
  return {
    action: decision.action,
    state: decision.action === "raise" ? "raised" : "recovered",
    reason: decision.reason,
    sent: { push: result.push, email: result.email },
    problems: result.problems,
  };
}
