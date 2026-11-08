import { describe, expect, it } from "vitest";
import { clerkFrontendApiOrigin, contentSecurityPolicy, securityHeaders } from "./security-headers";

const pk = (host: string, kind = "test") => `pk_${kind}_${Buffer.from(`${host}$`).toString("base64")}`;

describe("security headers", () => {
  it("decodes Clerk's Frontend API from the publishable key", () => {
    expect(clerkFrontendApiOrigin(pk("flying-quail-6182.clerk.accounts.dev"))).toBe("https://flying-quail-6182.clerk.accounts.dev");
    expect(clerkFrontendApiOrigin(pk("clerk.donquixote.app", "live"))).toBe("https://clerk.donquixote.app");
    expect(clerkFrontendApiOrigin(undefined)).toBeNull();
    expect(clerkFrontendApiOrigin("sk_test_abc")).toBeNull();
  });
  it("CSP allows Clerk, blocks framing and plugins, no unsafe-eval in production", () => {
    const csp = contentSecurityPolicy({ clerkOrigin: "https://clerk.donquixote.app", dev: false });
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://clerk.donquixote.app https://challenges.cloudflare.com");
    expect(csp).toContain("connect-src 'self' https://clerk.donquixote.app https://clerk-telemetry.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]* https:(\s|;|$)/);
    expect(contentSecurityPolicy({ clerkOrigin: null, dev: true })).toContain("'unsafe-eval'");
  });
  it("sends the standard headers; HSTS only in production", () => {
    const keys = securityHeaders({ clerkOrigin: null, dev: false }).map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security"]));
    expect(securityHeaders({ clerkOrigin: null, dev: true }).map((h) => h.key)).not.toContain("Strict-Transport-Security");
  });
});
