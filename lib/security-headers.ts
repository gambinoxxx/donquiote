// Security headers for every response (next.config.ts). Pure, so tested.
// The CSP allows: our own origin; Clerk's Frontend API (decoded from the
// publishable key, so it follows dev → production keys), Clerk telemetry,
// avatars, bot protection and Cloudflare Turnstile. Lightweight Charts
// draws on canvas from our own bundle. Links to claude.ai are plain
// navigations / new tabs, which CSP does not restrict.
// 'unsafe-inline' scripts: Next.js streams inline RSC payload scripts and
// our install-prompt script; nonces would force every page dynamic.

/** "pk_test_<base64 of host$>" → "https://host", or null. */
export function clerkFrontendApiOrigin(publishableKey: string | undefined): string | null {
  const m = /^pk_(?:test|live)_(.+)$/.exec(publishableKey ?? "");
  if (!m) return null;
  try {
    const host = Buffer.from(m[1]!, "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

const CLERK_PROTECT = "https://*.protect.clerk.com";

export function contentSecurityPolicy(opts: { clerkOrigin: string | null; dev: boolean }): string {
  const clerk = opts.clerkOrigin ? [opts.clerkOrigin] : [];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : []), ...clerk, "https://challenges.cloudflare.com", CLERK_PROTECT],
    "connect-src": ["'self'", ...clerk, "https://clerk-telemetry.com", "https://*.clerk-telemetry.com", "https://img.clerk.com", `${CLERK_PROTECT}:*`],
    "img-src": ["'self'", "data:", "blob:", "https://img.clerk.com"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "font-src": ["'self'", "data:"],
    "frame-src": ["'self'", "https://challenges.cloudflare.com", CLERK_PROTECT],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

export function securityHeaders(opts: { clerkOrigin: string | null; dev: boolean }): Array<{ key: string; value: string }> {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "X-Frame-Options", value: "DENY" },
    ...(opts.dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
  ];
}
