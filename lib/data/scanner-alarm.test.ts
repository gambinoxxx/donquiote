import { describe, expect, it, vi } from "vitest";
import { decideScannerAlarm, isAuthorized, runScannerCheck, type AlarmMessage, type AlarmState, type HeartbeatFacts, type ScannerCheckDeps } from "./scanner-alarm";

const MIN = 60_000;
// Tuesday 10 Nov 2026, 14:00 UTC = 15:00 Lagos: market open.
const NOW = new Date("2026-11-10T14:00:00.000Z");
const ago = (min: number, from = NOW) => new Date(from.getTime() - min * MIN).toISOString();
const hb = (okMinAgo: number | null, scanMinAgo = okMinAgo, extra: Partial<HeartbeatFacts> = {}): HeartbeatFacts => ({
  lastOkAt: okMinAgo === null ? null : ago(okMinAgo),
  lastScanAt: scanMinAgo === null ? null : ago(scanMinAgo),
  status: "ok",
  message: null,
  ...extra,
});
const OK_ALARM: AlarmState = { stoppedAt: null, lastOkAtWhenStopped: null };
const decide = (heartbeat: HeartbeatFacts | null, now = NOW, alarm = OK_ALARM) => decideScannerAlarm({ now, heartbeat, alarm, appUrl: "https://app.example" });

describe("cron auth", () => {
  const secret = "s".repeat(40);
  it("only the exact Bearer secret", () => {
    expect(isAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorized(null, secret)).toBe(false);
    expect(isAuthorized(secret, secret)).toBe(false);
    expect(isAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorized(`Bearer ${"t".repeat(40)}`, secret)).toBe(false);
    expect(isAuthorized(`Bearer ${secret}`, null)).toBe(false);
    expect(isAuthorized("Bearer ", "")).toBe(false);
  });
});

describe("stale vs fresh", () => {
  it("last OK scan within 45 min → nothing", () => {
    expect(decide(hb(15))).toMatchObject({ action: "none", state: "ok" });
    expect(decide(hb(45))).toMatchObject({ action: "none", state: "ok" });
  });
  it("older than 45 min while open → raise 'Scanner stopped at <Lagos time>'", () => {
    const d = decide(hb(46));
    expect(d.action).toBe("raise");
    if (d.action !== "raise") return;
    // 13:14 UTC = 14:14 Lagos.
    expect(d.message.push.title).toBe("Scanner stopped at 14:14");
    expect(d.message.email.subject).toBe("Scanner stopped at 14:14");
    expect(d.message.email.text).toContain("No successful scan since 14:14 Lagos");
    expect(d.message.email.text).toContain("https://app.example");
  });
  it("still scanning but failing → 'Scanner failing since', with the heartbeat reason", () => {
    const d = decide(hb(60, 5, { status: "degraded", message: "OANDA rejected the token" }));
    expect(d.action === "raise" && d.message.push.title).toBe("Scanner failing since 14:00");
    expect(d.action === "raise" && d.message.email.text).toContain("degraded — OANDA rejected the token");
  });
  it("never scanned while open → raise", () => {
    expect(decide(null).action).toBe("raise");
    expect(decide(hb(null, null)).action).toBe("raise");
  });
});

describe("market closed", () => {
  it("weekend: nothing, however old the last scan", () => {
    expect(decide(hb(60 * 30), new Date("2026-11-07T15:00:00Z"))).toMatchObject({ action: "none", state: "market_closed" });
  });
  it("just after the Sunday open: no alarm until the market has been open 45 min", () => {
    // Opens Sunday 8 Nov 2026 17:00 New York = 22:00 UTC.
    const friday = hb(null);
    friday.lastOkAt = "2026-11-06T21:45:10.000Z";
    expect(decide(friday, new Date("2026-11-08T22:30:00Z")).action).toBe("none");
    expect(decide(friday, new Date("2026-11-08T22:46:00Z")).action).toBe("raise");
  });
});

function memoryDeps(heartbeat: HeartbeatFacts | null) {
  let alarm: AlarmState = { ...OK_ALARM };
  const sent: AlarmMessage[] = [];
  const deps: ScannerCheckDeps & { hb: HeartbeatFacts | null } = {
    hb: heartbeat,
    appUrl: "https://app.example",
    loadHeartbeat: async () => deps.hb,
    loadAlarm: async () => ({ ...alarm }),
    claimRaise: async (at, lastOkAt) => {
      if (alarm.stoppedAt) return false;
      alarm = { stoppedAt: at, lastOkAtWhenStopped: lastOkAt };
      return true;
    },
    claimRecover: async (stoppedAt) => {
      if (alarm.stoppedAt !== stoppedAt) return false;
      alarm = { ...OK_ALARM };
      return true;
    },
    markChecked: vi.fn(async () => {}),
    send: vi.fn(async (m: AlarmMessage) => {
      sent.push(m);
      return { push: 2, email: 2, problems: [] };
    }),
  };
  return { deps, sent, alarm: () => alarm };
}

describe("one message per outage, then one 'Scanner back'", () => {
  it("raises once across many checks, recovers once", async () => {
    const { deps, sent, alarm } = memoryDeps(hb(50));
    const first = await runScannerCheck(NOW, deps);
    expect(first).toMatchObject({ action: "raise", state: "raised", sent: { push: 2, email: 2 } });
    for (const m of [15, 30, 45, 60]) {
      expect(await runScannerCheck(new Date(NOW.getTime() + m * MIN), deps)).toMatchObject({ action: "none", state: "stopped" });
    }
    expect(sent).toHaveLength(1);
    expect(alarm().stoppedAt).toBe(NOW.toISOString());

    // The worker comes back: a newer OK scan.
    const later = new Date(NOW.getTime() + 75 * MIN);
    deps.hb = { ...hb(null), lastOkAt: ago(2, later), lastScanAt: ago(2, later) };
    const back = await runScannerCheck(later, deps);
    expect(back).toMatchObject({ action: "recover", state: "recovered" });
    expect(sent[1]!.push.title).toMatch(/^Scanner back at /);
    expect(await runScannerCheck(new Date(later.getTime() + 15 * MIN), deps)).toMatchObject({ action: "none", state: "ok" });
    expect(sent).toHaveLength(2);
  });

  it("two overlapping checks send once (claim)", async () => {
    const { deps, sent } = memoryDeps(hb(50));
    const [a, b] = await Promise.all([runScannerCheck(NOW, deps), runScannerCheck(NOW, deps)]);
    expect([a.action, b.action].sort()).toEqual(["none", "raise"]);
    expect(sent).toHaveLength(1);
  });

  it("an outage that runs into the weekend recovers only on a new OK scan, with no second alarm", async () => {
    const { deps, sent } = memoryDeps(hb(50));
    await runScannerCheck(NOW, deps);
    expect((await runScannerCheck(new Date("2026-11-14T12:00:00Z"), deps)).state).toBe("stopped");
    expect((await runScannerCheck(new Date("2026-11-15T23:00:00Z"), deps)).state).toBe("stopped");
    expect(sent).toHaveLength(1);
  });

  it("a fresh heartbeat never sends anything", async () => {
    const { deps, sent } = memoryDeps(hb(10));
    expect((await runScannerCheck(NOW, deps)).state).toBe("ok");
    expect(sent).toHaveLength(0);
  });
});
