import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const SECRET = "sk_test_THIS-IS-A-FAKE-SECRET-VALUE";
const DB = "postgres://user:fake-password@host.neon.tech/db";
const good = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk",
  CLERK_SECRET_KEY: SECRET,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
  ALLOWED_EMAILS: "dg@example.com, gambino@example.com",
  DATABASE_URL: DB,
};

describe("server env (fails fast, names variables, never values)", () => {
  it("parses a complete env", () => {
    const env = parseServerEnv(good);
    expect(env.allowedEmails).toEqual(["dg@example.com", "gambino@example.com"]);
    expect(env.cronSecret).toBeNull();
  });
  it("names each missing variable", () => {
    const rest = { ...good, DATABASE_URL: undefined, CLERK_SECRET_KEY: undefined };
    expect(() => parseServerEnv(rest)).toThrow("Invalid environment variables");
    try {
      parseServerEnv(rest);
    } catch (e) {
      expect(String(e)).toContain("CLERK_SECRET_KEY: is missing");
      expect(String(e)).toContain("DATABASE_URL: is missing");
    }
  });
  it("an empty string counts as missing", () => {
    expect(() => parseServerEnv({ ...good, DATABASE_URL: "" })).toThrow("DATABASE_URL: is missing");
  });
  it("invalid values are named but never printed", () => {
    const badSecret = "not-a-clerk-key-SUPER-SECRET";
    try {
      parseServerEnv({ ...good, CLERK_SECRET_KEY: badSecret, CRON_SECRET: "short-secret-value" });
      expect.unreachable();
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain("CLERK_SECRET_KEY");
      expect(msg).toContain("CRON_SECRET: must be at least 32 characters");
      expect(msg).not.toContain(badSecret);
      expect(msg).not.toContain("short-secret-value");
      expect(msg).not.toContain("fake-password");
    }
  });
  it("CRON_SECRET is optional and kept when long enough", () => {
    expect(parseServerEnv({ ...good, CRON_SECRET: "x".repeat(40) }).cronSecret).toBe("x".repeat(40));
  });
});
