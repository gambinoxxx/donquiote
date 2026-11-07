"use server";

// Server actions for the dashboard. Every one checks the signed-in user is
// on the allowlist first, and validates its input.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAllowedUser } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { decideAlert, type DecideDb } from "./decide";
import { getAlerts } from "./index";
import { STATUS_FILTERS, type ActionResult, type AlertPage } from "./types";

const idSchema = z.string().min(1).max(64);
const filterSchema = z.object({
  status: z.enum(STATUS_FILTERS as readonly [string, ...string[]]),
  includeTest: z.boolean(),
  pair: z.enum(["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"]).optional(),
  cursor: z.string().max(64).nullish(),
});

/** Alerts list pages for the client (filters, test toggle, Load more). */
export async function loadAlerts(filter: unknown): Promise<AlertPage> {
  await requireAllowedUser();
  const parsed = filterSchema.parse(filter);
  return getAlerts({ ...parsed, status: parsed.status as (typeof STATUS_FILTERS)[number] });
}

async function decide(id: unknown, decision: "SKIPPED" | "TAKEN"): Promise<ActionResult> {
  const { email } = await requireAllowedUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid alert." };
  const result = await decideAlert(getDb() as unknown as DecideDb, parsed.data, decision, new Date(), email);
  if (result.ok) {
    revalidatePath(`/alerts/${parsed.data}`);
    revalidatePath("/alerts");
    revalidatePath("/journal");
    revalidatePath("/");
  }
  return result;
}

/** READY → SKIPPED. */
export async function markSkipped(id: unknown): Promise<ActionResult> {
  return decide(id, "SKIPPED");
}

/** READY → TAKEN, plus an OPEN journal entry with the alert's ticket. */
export async function markTaken(id: unknown): Promise<ActionResult> {
  return decide(id, "TAKEN");
}
