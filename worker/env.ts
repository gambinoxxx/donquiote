// Worker / script environment, validated with Zod. The worker is not
// Next.js: entry points load .env themselves (see worker/load-env.ts).
import { z } from "zod";

const workerEnvSchema = z.object({
  OANDA_API_TOKEN: z.string().min(1, "is required"),
  OANDA_ACCOUNT_ID: z
    .string()
    .regex(/^\d{3}-\d{3}-\d+-\d{3}$/, "must look like 101-004-1234567-001"),
  OANDA_ENV: z.enum(["practice", "live"]).default("practice"),
  DATABASE_URL: z.url(),
  // Direct (non-pooled) Neon URL: the worker lock and the migration check.
  DIRECT_URL: z.url(),
});

export type OandaEnv = "practice" | "live";

export interface WorkerEnv {
  oandaApiToken: string;
  oandaAccountId: string;
  oandaEnv: OandaEnv;
  databaseUrl: string;
  directUrl: string;
}

let cached: WorkerEnv | undefined;

/**
 * Validated worker env. Throws one error naming every missing or invalid
 * variable — never their values.
 */
export function getWorkerEnv(): WorkerEnv {
  cached ??= parseWorkerEnv(process.env);
  return cached;
}

/** Parses an env object; the error names each bad variable, never its value. */
export function parseWorkerEnv(env: Readonly<Record<string, string | undefined>>): WorkerEnv {
  // Treat empty strings (e.g. `OANDA_ENV=` copied from .env.example) as unset.
  const raw = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== ""),
  );
  const parsed = workerEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${raw[String(issue.path[0])] === undefined ? "is missing" : issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables (see doc/runbook.md and .env.example):\n${problems}`);
  }
  return {
    oandaApiToken: parsed.data.OANDA_API_TOKEN,
    oandaAccountId: parsed.data.OANDA_ACCOUNT_ID,
    oandaEnv: parsed.data.OANDA_ENV,
    databaseUrl: parsed.data.DATABASE_URL,
    directUrl: parsed.data.DIRECT_URL,
  };
}
