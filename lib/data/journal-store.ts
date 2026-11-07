// Journal writes (the db is passed in, so tests can fake it). Every write is
// guarded in the database: a result is logged once (OPEN → CLOSED), deleted
// entries can't change, and nothing here touches alerts or paper trades.
import { z } from "zod";
import { resultToPnl, type JournalResult } from "@/lib/risk/result";
import type { ActionResult } from "./types";

const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"] as const;
const price = z.number({ error: "Enter a price" }).positive("Must be above 0").finite();

export const resultInputSchema = z.object({
  result: z.enum(["WIN", "LOSS", "BREAKEVEN", "CUSTOM"]),
  r: z.number().positive("R must be above 0").max(20, "R at most 20").optional(),
  usd: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
});

export const tradeInputSchema = z
  .object({
    pair: z.enum(PAIRS),
    direction: z.enum(["BUY", "SELL"]),
    entry: price,
    stop: price,
    target: price,
    lots: z.number({ error: "Enter the lot size" }).min(0.01, "At least 0.01 lots").max(100, "At most 100 lots"),
    riskUsd: z.number({ error: "Enter the risk in USD" }).positive("Risk must be above $0").max(1_000_000),
    /** ISO; defaults to now. */
    openedAt: z.iso.datetime().optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine((t, ctx) => {
    const sell = t.direction === "SELL";
    if (sell ? !(t.stop > t.entry) : !(t.stop < t.entry)) {
      ctx.addIssue({ code: "custom", path: ["stop"], message: sell ? "For a sell, the stop is above entry" : "For a buy, the stop is below entry" });
    }
    if (sell ? !(t.target < t.entry) : !(t.target > t.entry)) {
      ctx.addIssue({ code: "custom", path: ["target"], message: sell ? "For a sell, the target is below entry" : "For a buy, the target is above entry" });
    }
  });

export type TradeInput = z.infer<typeof tradeInputSchema>;
export type ResultInput = z.infer<typeof resultInputSchema>;

export interface JournalDb {
  journalEntry: {
    findFirst(args: { where: { id: string; deletedAt: null } }): Promise<{ id: string; status: "OPEN" | "CLOSED"; riskUsd: number } | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

type Fail = { ok: false; error: string; fieldErrors?: Array<{ path: string; message: string }> };
const fail = (error: z.ZodError): Fail => ({
  ok: false,
  error: error.issues[0]?.message ?? "Check the values.",
  fieldErrors: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
});

function money(input: ResultInput, riskUsd: number): { pnlUsd: number; resultR: number } | Fail {
  if (input.result === "CUSTOM" && input.usd === undefined) return { ok: false, error: "Enter the result in USD" };
  return resultToPnl(input.result as JournalResult, riskUsd, { r: input.r, usd: input.usd });
}

/** OPEN → CLOSED with the result. A closed entry can't be logged again (edit it instead). */
export async function logResult(db: JournalDb, id: string, raw: unknown, now: Date): Promise<ActionResult | Fail> {
  const parsed = resultInputSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error);
  const entry = await db.journalEntry.findFirst({ where: { id, deletedAt: null } });
  if (!entry) return { ok: false, error: "Trade not found." };
  if (entry.status !== "OPEN") return { ok: false, error: "This trade already has a result. Edit it to change it." };
  const m = money(parsed.data, entry.riskUsd);
  if ("ok" in m) return m;
  const { count } = await db.journalEntry.updateMany({
    where: { id, status: "OPEN", deletedAt: null },
    data: { status: "CLOSED", result: parsed.data.result, pnlUsd: m.pnlUsd, resultR: m.resultR, closedAt: now },
  });
  return count === 1 ? { ok: true } : { ok: false, error: "This trade already has a result. Edit it to change it." };
}

export async function addManualTrade(db: JournalDb, raw: unknown, email: string, now: Date): Promise<(ActionResult & { id?: string }) | Fail> {
  const parsed = tradeInputSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error);
  const t = parsed.data;
  const row = await db.journalEntry.create({
    data: {
      alertId: null,
      strategyId: null,
      pair: t.pair,
      direction: t.direction,
      entry: t.entry,
      stop: t.stop,
      target: t.target,
      lots: t.lots,
      riskUsd: t.riskUsd,
      openedAt: t.openedAt ? new Date(t.openedAt) : now,
      status: "OPEN",
      note: t.note ?? null,
      createdBy: email,
    },
  });
  return { ok: true, id: row.id };
}

/** Edits the trade; for a closed one the result can change too (money recomputed). */
export async function editEntry(db: JournalDb, id: string, raw: unknown): Promise<ActionResult | Fail> {
  const input = z.object({ trade: tradeInputSchema, result: resultInputSchema.optional() }).safeParse(raw);
  if (!input.success) return fail(input.error);
  const entry = await db.journalEntry.findFirst({ where: { id, deletedAt: null } });
  if (!entry) return { ok: false, error: "Trade not found." };
  const t = input.data.trade;
  const data: Record<string, unknown> = {
    pair: t.pair,
    direction: t.direction,
    entry: t.entry,
    stop: t.stop,
    target: t.target,
    lots: t.lots,
    riskUsd: t.riskUsd,
    note: t.note ?? null,
    ...(t.openedAt && { openedAt: new Date(t.openedAt) }),
  };
  if (entry.status === "CLOSED" && input.data.result) {
    const m = money(input.data.result, t.riskUsd);
    if ("ok" in m) return m;
    Object.assign(data, { result: input.data.result.result, pnlUsd: m.pnlUsd, resultR: m.resultR });
  }
  const { count } = await db.journalEntry.updateMany({ where: { id, deletedAt: null }, data });
  return count === 1 ? { ok: true } : { ok: false, error: "Trade not found." };
}

/** Soft delete: the entry stops counting everywhere (guard, stats, export). */
export async function deleteEntry(db: JournalDb, id: string, now: Date): Promise<ActionResult> {
  const { count } = await db.journalEntry.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: now } });
  return count === 1 ? { ok: true } : { ok: false, error: "Trade not found." };
}
