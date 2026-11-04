// Server-side access guard. This is the real security line: every server
// action, route handler and page that reads or writes data calls it first.
// The proxy redirect is only a convenience.
import { auth } from "@clerk/nextjs/server";
import { isEmailAllowed, normalizeEmail } from "./allowlist";
import { getServerEnv } from "./env";

export interface AllowedUser {
  userId: string;
  /** Normalised (trimmed, lowercased) email from the session token. */
  email: string;
}

export class NotAllowedError extends Error {
  constructor(reason: "signed-out" | "not-on-allowlist") {
    super(
      reason === "signed-out"
        ? "Not signed in"
        : "This email is not allowed to use the app",
    );
    this.name = "NotAllowedError";
  }
}

/**
 * Returns the signed-in user when their session email is on ALLOWED_EMAILS.
 * Throws NotAllowedError otherwise. The email comes from the `email` claim
 * added to the Clerk session token in the dashboard.
 */
export async function requireAllowedUser(): Promise<AllowedUser> {
  const { userId, sessionClaims } = await auth();
  if (!userId) throw new NotAllowedError("signed-out");

  const email: unknown = sessionClaims?.email;
  if (typeof email !== "string" || !isEmailAllowed(email, getServerEnv().allowedEmails)) {
    throw new NotAllowedError("not-on-allowlist");
  }
  return { userId, email: normalizeEmail(email) };
}
