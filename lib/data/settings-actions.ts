"use server";

// Settings, watchlist and strategy modes: the only writers (invariant 13).
// Every action checks the user, then goes through saveSnapshot (one
// transaction with a SettingsVersion). Changes apply from the next scan.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAllowedUser } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { getStrategyInfo } from "@/lib/strategy/registry";
import type { SettingsSnapshot } from "@/lib/settings";
import { restoreTarget, saveSnapshot, type SaveResult, type SettingsDb } from "./settings-store";

const baseSchema = z.string().max(64).nullable();
const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"] as const;

function strategyName(id: string): string {
  try {
    return getStrategyInfo(id).name;
  } catch {
    return id;
  }
}

function db(): SettingsDb {
  return getDb() as unknown as SettingsDb;
}

function revalidateAll() {
  for (const path of ["/", "/settings", "/settings/history", "/strategies", "/watchlist", "/chart", "/alerts", "/news"]) revalidatePath(path);
}

async function run(baseVersionId: unknown, build: (current: SettingsSnapshot) => unknown, restoredFromId?: string): Promise<SaveResult> {
  const { email } = await requireAllowedUser();
  const base = baseSchema.safeParse(baseVersionId);
  if (!base.success) return { ok: false, error: "Invalid request. Reload and try again." };
  const result = await saveSnapshot(db(), { email, baseVersionId: base.data, build, restoredFromId, strategyName });
  if (result.ok && !("noChanges" in result)) revalidateAll();
  return result;
}

/** Saves the whole settings snapshot (the Settings screen). */
export async function saveSettings(next: unknown, baseVersionId: unknown): Promise<SaveResult> {
  return run(baseVersionId, () => next);
}

/** One strategy's mode (the Strategies screen). */
export async function setStrategyMode(strategyId: unknown, mode: unknown, baseVersionId: unknown): Promise<SaveResult> {
  const parsed = z.object({ strategyId: z.string().min(1).max(64), mode: z.enum(["LIVE", "TEST", "OFF"]) }).safeParse({ strategyId, mode });
  if (!parsed.success) {
    await requireAllowedUser();
    return { ok: false, error: "Invalid strategy or mode." };
  }
  return run(baseVersionId, (current) => ({
    ...current,
    strategies: current.strategies.map((s) => (s.strategyId === parsed.data.strategyId ? { ...s, mode: parsed.data.mode } : s)),
  }));
}

/** One watchlist pair on or off (the Watchlist screen). */
export async function setPairEnabled(pair: unknown, enabled: unknown, baseVersionId: unknown): Promise<SaveResult> {
  const parsed = z.object({ pair: z.enum(PAIRS), enabled: z.boolean() }).safeParse({ pair, enabled });
  if (!parsed.success) {
    await requireAllowedUser();
    return { ok: false, error: "Invalid pair." };
  }
  return run(baseVersionId, (current) => ({
    ...current,
    watchlist: current.watchlist.map((w) => (w.pair === parsed.data.pair ? { ...w, enabled: parsed.data.enabled } : w)),
  }));
}

/** One news toggle (the News screen). Saved like any other setting, with history. */
export async function setNewsSetting(key: unknown, value: unknown, baseVersionId: unknown): Promise<SaveResult> {
  const parsed = z.object({ key: z.enum(["newsPushCalendar", "newsPushHeadlines"]), value: z.boolean() }).safeParse({ key, value });
  if (!parsed.success) {
    await requireAllowedUser();
    return { ok: false, error: "Invalid setting." };
  }
  return run(baseVersionId, (current) => ({ ...current, settings: { ...current.settings, [parsed.data.key]: parsed.data.value } }));
}

/** Puts an older version's values back, as a new version (so it can be undone). */
export async function restoreSettings(versionId: unknown, baseVersionId: unknown): Promise<SaveResult> {
  await requireAllowedUser();
  const id = z.string().min(1).max(64).safeParse(versionId);
  if (!id.success) return { ok: false, error: "Invalid version." };
  const version = await getDb().settingsVersion.findUnique({ where: { id: id.data }, select: { id: true, snapshot: true } });
  if (!version) return { ok: false, error: "That version no longer exists." };
  const old = version.snapshot as unknown as SettingsSnapshot;
  return run(baseVersionId, (current) => restoreTarget(current, old), version.id);
}
