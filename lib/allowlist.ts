// Pure allowlist logic. No I/O, no env access: callers pass the list in.

/** Normalises an email for comparison: trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Parses the comma-separated ALLOWED_EMAILS value into normalised emails.
 * Blank entries are dropped, so "" or " , " gives an empty list.
 */
export function parseAllowedEmails(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map(normalizeEmail)
    .filter((email) => email.length > 0);
}

/**
 * True only when `email` is a non-empty string on the allowlist.
 * A missing email claim or an empty allowlist always denies.
 */
export function isEmailAllowed(
  email: unknown,
  allowedEmails: readonly string[],
): boolean {
  if (typeof email !== "string") return false;
  const normalized = normalizeEmail(email);
  if (normalized.length === 0) return false;
  return allowedEmails.some((allowed) => normalizeEmail(allowed) === normalized);
}
