// Server-only environment variables, validated with Zod.
// Never import this from a client component.
import { z } from "zod";
import { parseAllowedEmails } from "./allowlist";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
    .string()
    .regex(/^pk_(test|live)_/, "must start with pk_test_ or pk_live_"),
  CLERK_SECRET_KEY: z
    .string()
    .regex(/^sk_(test|live)_/, "must start with sk_test_ or sk_live_"),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.literal("/sign-in", {
    error: 'must be "/sign-in"',
  }),
  ALLOWED_EMAILS: z
    .string()
    .transform(parseAllowedEmails)
    .refine((emails) => emails.length > 0, "must list at least one email")
    .refine(
      (emails) => emails.every((email) => z.email().safeParse(email).success),
      "must be comma-separated email addresses",
    ),
  DATABASE_URL: z.url("must be a postgres:// URL (the pooled Neon URL)"),
  // Optional: only the "Scanner stopped" alarm route needs it (Step 6).
  CRON_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
});

export interface ServerEnv {
  clerkPublishableKey: string;
  clerkSecretKey: string;
  signInUrl: string;
  /** Normalised (trimmed, lowercased) allowlist. Never empty. */
  allowedEmails: readonly string[];
  /** Bearer secret for /api/cron/scanner-check; null = the route answers 503. */
  cronSecret: string | null;
}

let cached: ServerEnv | undefined;

/**
 * Parses an env object. Throws one clear error naming every missing or
 * invalid variable (never their values). Empty strings count as missing.
 */
export function parseServerEnv(env: Readonly<Record<string, string | undefined>>): ServerEnv {
  const raw = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const parsed = serverEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${raw[String(issue.path[0])] === undefined ? "is missing" : issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables (see doc/runbook.md and .env.example):\n${problems}`,
    );
  }
  return {
    clerkPublishableKey: parsed.data.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: parsed.data.CLERK_SECRET_KEY,
    signInUrl: parsed.data.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
    allowedEmails: parsed.data.ALLOWED_EMAILS,
    cronSecret: parsed.data.CRON_SECRET ?? null,
  };
}

/** Validated server env (cached). Runs at server start via instrumentation.ts. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
