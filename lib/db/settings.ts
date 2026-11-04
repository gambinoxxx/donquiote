import { getDb } from "./client";
import type { Settings } from "./generated/client";

export const SETTINGS_ID = 1;

/** The single Settings row. Throws if the database has not been seeded. */
export async function getSettings(): Promise<Settings> {
  return getDb().settings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
}
