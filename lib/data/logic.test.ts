import { describe, expect, it } from "vitest";
import {
  alertsWhere,
  heartbeatView,
  orderStrategies,
  paperOutcomeText,
  reasonLine,
  ruleChecklist,
  scoreboard,
  seenBy,
  toPage,
} from "./logic";
import type { Direction, Pair } from "@/lib/types";
import type { StrategyTag } from "./types";

const tag = (id: string, mode: StrategyTag["mode"] = "TEST"): StrategyTag => ({ id, code: id.toUpperCase(), name: id, mode });

describe("alertsWhere (filters and includeTest)", () => {
  const live = ["dg-v1"];
  it("all + live only", () => {
    expect(alertsWhere({ status: "all", includeTest: false, liveStrategyIds: live })).toEqual({ strategyId: { in: ["dg-v1"] } });
  });
  it("test signals included: no strategy filter", () => {
    expect(alertsWhere({ status: "all", includeTest: true, liveStrategyIds: live })).toEqual({});
  });
  it("Ready also shows taken alerts; each chip maps to its statuses", () => {
    expect(alertsWhere({ status: "ready", includeTest: true, liveStrategyIds: live })).toEqual({ status: { in: ["READY", "TAKEN"] } });
    expect(alertsWhere({ status: "watching", includeTest: true, liveStrategyIds: live })).toEqual({ status: { in: ["WATCHING"] } });
    expect(alertsWhere({ status: "expired", includeTest: true, liveStrategyIds: live })).toEqual({ status: { in: ["EXPIRED"] } });
    expect(alertsWhere({ status: "skipped", includeTest: true, liveStrategyIds: live })).toEqual({ status: { in: ["SKIPPED"] } });
  });
  it("pair filter, combined", () => {
    expect(alertsWhere({ status: "watching", includeTest: false, liveStrategyIds: live, pair: "USD_JPY" })).toEqual({
      status: { in: ["WATCHING"] },
      strategyId: { in: ["dg-v1"] },
      pair: "USD_JPY",
    });
  });
  it("no LIVE strategy and test hidden: matches nothing", () => {
    expect(alertsWhere({ status: "all", includeTest: false, liveStrategyIds: [] })).toEqual({ strategyId: { in: [] } });
  });
});

describe("toPage (cursor pagination, 30 per page)", () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({ id: `a${i}` }));
  it("31 rows fetched → 30 shown and a cursor at the 30th", () => {
    const page = toPage(rows);
    expect(page.rows).toHaveLength(30);
    expect(page.nextCursor).toBe("a29");
  });
  it("the last page has no cursor", () => {
    expect(toPage(rows.slice(0, 30)).nextCursor).toBeNull();
    expect(toPage([]).nextCursor).toBeNull();
  });
});

describe("scoreboard", () => {
  const row = (strategyId: string, paperStatus: "OPEN" | "WIN" | "LOSS" | "UNRESOLVED" | "NOT_FILLED", day: number, r: number | null) => ({
    strategyId,
    paperStatus,
    paperClosedAt: paperStatus === "OPEN" ? null : `2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    paperResultR: r,
    paperPnlUsd: r === null ? null : r * 50,
  });

  it("unresolved and not-filled stay out of the win rate; not-filled is not a trade", () => {
    const [v1] = scoreboard(
      [tag("dg-v1", "LIVE")],
      [row("dg-v1", "WIN", 1, 3), row("dg-v1", "LOSS", 2, -1), row("dg-v1", "UNRESOLVED", 3, 0.5), row("dg-v1", "NOT_FILLED", 4, 0), row("dg-v1", "OPEN", 0, null)],
    );
    expect(v1).toMatchObject({ trades: 4, wins: 1, losses: 1, unresolved: 1, notFilled: 1, open: 1, winRate: 0.5, netR: 2.5, netUsd: 125, closed: 3 });
  });

  it("early under 30 closed trades, not at 30", () => {
    const many = Array.from({ length: 30 }, (_, i) => row("pro", i % 2 ? "WIN" : "LOSS", (i % 28) + 1, i % 2 ? 3 : -1));
    const [early, notEarly] = scoreboard([tag("dg-v1", "LIVE"), tag("pro")], [...many.slice(0, 29).map((r) => ({ ...r, strategyId: "dg-v1" })), ...many]);
    expect(early).toMatchObject({ closed: 29, early: true });
    expect(notEarly).toMatchObject({ closed: 30, early: false });
  });

  it("one row per strategy that isn't OFF, even with no trades; LIVE first", () => {
    const rows = scoreboard(orderStrategies([tag("v2"), tag("dg-v1", "LIVE"), tag("old", "OFF")]), []);
    expect(rows.map((r) => [r.strategy.id, r.trades, r.winRate, r.early])).toEqual([
      ["dg-v1", 0, null, true],
      ["v2", 0, null, true],
    ]);
  });
});

describe("seenBy", () => {
  const tags: Record<string, StrategyTag> = { "dg-v1": tag("dg-v1", "LIVE"), pro: tag("pro", "LIVE"), fvg: tag("fvg"), v2: tag("v2") };
  const base: { strategyId: string; pair: Pair; direction: Direction; time: string } = {
    strategyId: "dg-v1",
    pair: "EUR_USD",
    direction: "SELL",
    time: "2026-11-04T10:00:00.000Z",
  };
  const near = (strategyId: string, minutes: number, over: Partial<typeof base> = {}) => ({
    ...base,
    strategyId,
    time: new Date(Date.parse(base.time) + minutes * 60_000).toISOString(),
    ...over,
  });

  it("this strategy first, then others on the same pair + direction within 30 minutes (Live first)", () => {
    const out = seenBy({
      alert: base,
      groupStrategyIds: [],
      nearby: [near("fvg", -20), near("pro", 30), near("v2", 31), near("v2", 5, { direction: "BUY" }), near("v2", 5, { pair: "GBP_USD" })],
      tag: (id) => tags[id] as StrategyTag,
    });
    expect(out.map((t) => t.id)).toEqual(["dg-v1", "pro", "fvg"]);
  });

  it("uses the notification group's strategies too, without duplicates", () => {
    const out = seenBy({ alert: base, groupStrategyIds: ["dg-v1", "pro"], nearby: [near("pro", 2)], tag: (id) => tags[id] as StrategyTag });
    expect(out.map((t) => t.id)).toEqual(["dg-v1", "pro"]);
  });
});

describe("heartbeatView", () => {
  const now = new Date("2026-11-04T10:00:00.000Z"); // Wednesday, market open
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  it("ok, slow after 20 min, stopped after 45 min, market closed at weekends", () => {
    expect(heartbeatView(ago(2), now, true)).toEqual({ state: "ok", text: "Scanner OK · last scan 2 min ago" });
    expect(heartbeatView(ago(21), now, true)).toEqual({ state: "slow", text: "Scanner slow · last scan 21 min ago" });
    expect(heartbeatView(ago(46), now, true)).toEqual({ state: "stopped", text: "Scanner stopped · last scan 46 min ago" });
    expect(heartbeatView(ago(600), now, false).state).toBe("closed");
    expect(heartbeatView(null, now, true).state).toBe("unknown");
  });
});

describe("reason line, checklist and paper text", () => {
  const facts = {
    strategyId: "dg-v1",
    pair: "EUR_USD" as const,
    direction: "SELL" as const,
    status: "READY" as const,
    sweepType: "PDH",
    sweepLevel: 1.107,
    bosLevel: 1.1015,
    entry: 1.101,
    stop: 1.1081,
    target: 1.0797,
    stopPips: 71,
    readyAt: "2026-11-04T00:00:00.000Z",
    statusNote: null,
    entryType: "MARKET" as const,
    paperStatus: "OPEN" as const,
  };

  it("reason lines follow the status", () => {
    expect(reasonLine(facts)).toBe("Swept previous day high 1.10700, 15m body closed below 1.10150");
    expect(reasonLine({ ...facts, status: "WATCHING", readyAt: null })).toBe(
      "Swept previous day high 1.10700, waiting for a 15m body close below 1.10150",
    );
    expect(reasonLine({ ...facts, status: "EXPIRED", readyAt: null })).toBe("Swept previous day high 1.10700, no confirmation in time");
    expect(reasonLine({ ...facts, strategyId: "gemini-fvg", sweepType: "ASH", entryType: "LIMIT" })).toBe(
      "Swept Asian session high 1.10700, fair value gap, limit 1.10100",
    );
  });

  it("checklist marks from stored fields: met, not met, waiting, background", () => {
    const rules = [
      { text: "Trend", check: "trend" as const },
      { text: "Sweep", check: "sweep" as const },
      { text: "Confirm", check: "confirm" as const },
      { text: "Ticket", check: "ticket" as const },
      { text: "Expiry", check: "none" as const },
    ];
    expect(ruleChecklist(rules, facts).map((r) => r.state)).toEqual(["met", "met", "met", "met", "info"]);
    expect(ruleChecklist(rules, { ...facts, status: "EXPIRED", readyAt: null, entry: null, stop: null, target: null }).map((r) => r.state)).toEqual([
      "met",
      "met",
      "not-met",
      "pending",
      "info",
    ]);
    expect(ruleChecklist(rules, { ...facts, status: "WATCHING", readyAt: null, entry: null, stop: null, target: null })[2]?.state).toBe("pending");
    expect(ruleChecklist([{ text: "Fill", check: "fill" }], { ...facts, paperStatus: "NOT_FILLED" })[0]?.state).toBe("not-met");
  });

  it("paper outcome text", () => {
    const p = { status: "WIN" as const, resultR: 3, pnlUsd: 150, exitPrice: 1.0797, openedAt: "2026-11-04T00:00:00.000Z", closedAt: "2026-11-04T03:15:00.000Z", note: null };
    expect(paperOutcomeText(p)).toBe("Target hit after 3h 15m");
    expect(paperOutcomeText({ ...p, status: "NOT_FILLED" })).toContain("never reached");
  });
});
