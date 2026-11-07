"use server";

// Journal server actions. Each checks the signed-in user first; the guarded
// writes are in journal-store.ts. The risk guard updates from the next read.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAllowedUser } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import * as store from "./journal-store";
import type { ActionResult } from "./types";

type Result = ActionResult | { ok: false; error: string; fieldErrors?: Array<{ path: string; message: string }> };

const idSchema = z.string().min(1).max(64);
const db = () => getDb() as unknown as store.JournalDb;

function refresh() {
  revalidatePath("/");
  revalidatePath("/journal");
  revalidatePath("/alerts", "layout");
}

/** Win / Loss / Break-even / Custom for an OPEN trade (once). */
export async function logResult(entryId: unknown, input: unknown): Promise<Result> {
  await requireAllowedUser();
  const id = idSchema.safeParse(entryId);
  if (!id.success) return { ok: false, error: "Invalid trade." };
  const result = await store.logResult(db(), id.data, input, new Date());
  if (result.ok) refresh();
  return result;
}

/** A trade DG took outside the app. */
export async function addManualTrade(input: unknown): Promise<Result> {
  const { email } = await requireAllowedUser();
  const result = await store.addManualTrade(db(), input, email, new Date());
  if (result.ok) refresh();
  return result;
}

export async function editEntry(entryId: unknown, input: unknown): Promise<Result> {
  await requireAllowedUser();
  const id = idSchema.safeParse(entryId);
  if (!id.success) return { ok: false, error: "Invalid trade." };
  const result = await store.editEntry(db(), id.data, input);
  if (result.ok) refresh();
  return result;
}

/** Soft delete: it stops counting everywhere. */
export async function deleteEntry(entryId: unknown): Promise<Result> {
  await requireAllowedUser();
  const id = idSchema.safeParse(entryId);
  if (!id.success) return { ok: false, error: "Invalid trade." };
  const result = await store.deleteEntry(db(), id.data, new Date());
  if (result.ok) refresh();
  return result;
}
