// Startup check: the worker refuses to run against a database whose
// migrations are behind the code (a release whose `npm run db:deploy` was
// forgotten). Compares prisma/migrations with Prisma's _prisma_migrations.
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getDb } from "@/lib/db/client";

const MIGRATIONS_DIR = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));

export interface AppliedMigration {
  name: string;
  finished: boolean;
  rolledBack: boolean;
}

export interface MigrationStatus {
  /** In the code, not (successfully) applied to the database. */
  pending: string[];
  /** Started but never finished (a failed migrate deploy). */
  failed: string[];
  /** Applied to the database but unknown to this code (an older worker image). */
  unknown: string[];
}

/** Pure: compares the code's migration folders with the database's table. */
export function migrationStatus(local: readonly string[], applied: readonly AppliedMigration[]): MigrationStatus {
  const ok = new Set(applied.filter((m) => m.finished && !m.rolledBack).map((m) => m.name));
  const failed = applied.filter((m) => !m.finished && !m.rolledBack).map((m) => m.name);
  const localSet = new Set(local);
  return {
    pending: local.filter((n) => !ok.has(n)).sort(),
    failed: [...new Set(failed)].sort(),
    unknown: [...ok].filter((n) => !localSet.has(n)).sort(),
  };
}

/** The error the worker exits with, or null when the database is current. */
export function migrationProblem(s: MigrationStatus): string | null {
  if (s.failed.length > 0) {
    return `Database migration failed earlier (${s.failed.join(", ")}). Fix it (see doc/runbook.md → Releases), then restart the worker.`;
  }
  if (s.pending.length > 0) {
    return `Database is behind the code: ${s.pending.length} migration(s) not applied (${s.pending.join(", ")}). Run \`npm run db:deploy\` against the production database, then restart the worker.`;
  }
  return null;
}

export async function localMigrations(dir = MIGRATIONS_DIR): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

export async function appliedMigrations(): Promise<AppliedMigration[]> {
  try {
    const rows = await getDb().$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      select migration_name, finished_at, rolled_back_at from "_prisma_migrations"`;
    return rows.map((r) => ({ name: r.migration_name, finished: r.finished_at !== null, rolledBack: r.rolled_back_at !== null }));
  } catch (error) {
    // No table yet = an empty database: nothing applied.
    if (/_prisma_migrations|does not exist|42P01/i.test(error instanceof Error ? error.message : String(error))) return [];
    throw error;
  }
}

export async function checkMigrations(): Promise<MigrationStatus> {
  return migrationStatus(await localMigrations(), await appliedMigrations());
}
