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
});

export interface ServerEnv {
  clerkPublishableKey: string;
  clerkSecretKey: string;
  signInUrl: string;
  /** Normalised (trimmed, lowercased) allowlist. Never empty. */
  allowedEmails: readonly string[];
}

let cached: ServerEnv | undefined;

/**
 * Validated server env. Throws one clear error naming every missing or
 * invalid variable (never their values).
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables (see .env.example):\n${problems}`,
    );
  }
  cached = {
    clerkPublishableKey: parsed.data.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: parsed.data.CLERK_SECRET_KEY,
    signInUrl: parsed.data.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
    allowedEmails: parsed.data.ALLOWED_EMAILS,
  };
  return cached;
}
