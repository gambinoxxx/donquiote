// The one write path for Settings, the watchlist and strategy modes
// (architecture invariant 13). Everything happens in one transaction:
// lock → check the base version → load current → apply the change →
// validate → diff → write the values and a SettingsVersion. If any step
// fails, nothing is written. Called by the server actions in
// settings-actions.ts and by the seed (first version only).
import { SETTINGS_KEYS, diff, snapshot, validate, type Change, type SettingsSnapshot } from "@/lib/settings";

/** Advisory lock key ("SETS") so two saves never interleave. */
export const SETTINGS_LOCK_KEY = 0x53455453;
export const STALE_MESSAGE = "Settings were changed on another device. Reload to see them.";
export const NO_CHANGES_MESSAGE = "No changes";

export type SaveResult =
  | { ok: true; versionId: string; changes: Change[] }
  | { ok: true; noChanges: true; versionId: string }
  | { ok: false; error: string; stale?: true; fieldErrors?: Array<{ path: string; message: string }> };

/** The Prisma calls used here (the real transaction client, or a fake in tests). */
export interface SettingsTx {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  settings: {
    findUniqueOrThrow(args: { where: { id: number } }): Promise<Record<string, unknown>>;
    update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<unknown>;
  };
  watchlistPair: {
    findMany(args?: unknown): Promise<Array<{ pair: string; enabled: boolean; sortOrder: number }>>;
    update(args: { where: { pair: string }; data: { enabled: boolean } }): Promise<unknown>;
  };
  strategyConfig: {
    findMany(args?: unknown): Promise<Array<{ strategyId: string; mode: string }>>;
    update(args: { where: { strategyId: string }; data: { mode: string } }): Promise<unknown>;
  };
  settingsVersion: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: { data: { createdBy: string; snapshot: unknown; changes: unknown; restoredFromId?: string | null } }): Promise<{ id: string }>;
  };
}

export interface SettingsDb {
  $transaction<T>(fn: (tx: SettingsTx) => Promise<T>): Promise<T>;
}

export const LATEST_VERSION = { orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } } as const;

/** Current values as a snapshot. */
export async function loadSnapshot(tx: Pick<SettingsTx, "settings" | "watchlistPair" | "strategyConfig">): Promise<SettingsSnapshot> {
  const [row, pairs, modes] = await Promise.all([
    tx.settings.findUniqueOrThrow({ where: { id: 1 } }),
    tx.watchlistPair.findMany({ orderBy: { sortOrder: "asc" } }),
    tx.strategyConfig.findMany({ orderBy: { strategyId: "asc" } }),
  ]);
  return snapshot(
    Object.fromEntries(SETTINGS_KEYS.map((k) => [k, row[k]])) as never,
    pairs as never,
    modes as never,
  );
}

/**
 * Applies `build(current)` as the next state. `baseVersionId` must be the
 * latest version (safe saving across devices). Returns "No changes" without
 * writing when nothing differs.
 */
export async function saveSnapshot(
  db: SettingsDb,
  args: {
    email: string;
    baseVersionId: string | null;
    build: (current: SettingsSnapshot) => unknown;
    restoredFromId?: string;
    strategyName?: (id: string) => string;
  },
): Promise<SaveResult> {
  return db.$transaction(async (tx) => {
    // pg_advisory_xact_lock returns void, which Prisma can't read: select a constant instead.
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(${SETTINGS_LOCK_KEY})) AS l`;
    const latest = await tx.settingsVersion.findFirst(LATEST_VERSION);
    if (latest && latest.id !== args.baseVersionId) return { ok: false, stale: true, error: STALE_MESSAGE };

    const current = await loadSnapshot(tx);
    const checked = validate(args.build(current));
    if (!checked.ok) {
      return { ok: false, error: checked.errors[0]?.message ?? "Some values are not valid.", fieldErrors: checked.errors };
    }
    const next = snapshot(checked.snapshot.settings, checked.snapshot.watchlist, checked.snapshot.strategies);
    // Only existing pairs and strategies can change (no rows added or removed here).
    const samePairs = JSON.stringify(next.watchlist.map((w) => w.pair).sort()) === JSON.stringify(current.watchlist.map((w) => w.pair).sort());
    const sameStrategies =
      JSON.stringify(next.strategies.map((s) => s.strategyId)) === JSON.stringify(current.strategies.map((s) => s.strategyId));
    if (!samePairs || !sameStrategies) return { ok: false, error: "The list of pairs or strategies doesn't match. Reload and try again." };

    const changes = diff(current, next, args.strategyName);
    if (changes.length === 0) return { ok: true, noChanges: true, versionId: latest?.id ?? "" };

    const changedSettings = Object.fromEntries(SETTINGS_KEYS.filter((k) => current.settings[k] !== next.settings[k]).map((k) => [k, next.settings[k]]));
    if (Object.keys(changedSettings).length > 0) await tx.settings.update({ where: { id: 1 }, data: changedSettings });
    for (const w of next.watchlist) {
      if (current.watchlist.find((c) => c.pair === w.pair)?.enabled !== w.enabled) {
        await tx.watchlistPair.update({ where: { pair: w.pair }, data: { enabled: w.enabled } });
      }
    }
    for (const s of next.strategies) {
      if (current.strategies.find((c) => c.strategyId === s.strategyId)?.mode !== s.mode) {
        await tx.strategyConfig.update({ where: { strategyId: s.strategyId }, data: { mode: s.mode } });
      }
    }
    // The version is written last: if it fails, the transaction undoes the values too.
    const version = await tx.settingsVersion.create({
      data: { createdBy: args.email, snapshot: next, changes, restoredFromId: args.restoredFromId ?? null },
    });
    return { ok: true, versionId: version.id, changes };
  });
}

/** Restoring an old snapshot: its values, for the pairs / strategies that still exist. */
export function restoreTarget(current: SettingsSnapshot, old: SettingsSnapshot): SettingsSnapshot {
  return {
    settings: { ...current.settings, ...old.settings },
    watchlist: current.watchlist.map((w) => ({ ...w, enabled: old.watchlist.find((o) => o.pair === w.pair)?.enabled ?? w.enabled })),
    strategies: current.strategies.map((s) => ({ ...s, mode: old.strategies.find((o) => o.strategyId === s.strategyId)?.mode ?? s.mode })),
  };
}
