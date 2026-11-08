import { describe, expect, it } from "vitest";
import { parseWorkerEnv } from "./env";

const good = {
  OANDA_API_TOKEN: "fake-oanda-token-value",
  OANDA_ACCOUNT_ID: "101-004-1234567-001",
  DATABASE_URL: "postgres://u:fake-password@host-pooler.neon.tech/db",
  DIRECT_URL: "postgres://u:fake-password@host.neon.tech/db",
};

describe("worker env", () => {
  it("parses, OANDA_ENV defaults to practice", () => {
    expect(parseWorkerEnv(good)).toMatchObject({ oandaEnv: "practice", directUrl: good.DIRECT_URL });
  });
  it("names missing variables, never values", () => {
    const rest = { ...good, DIRECT_URL: undefined, OANDA_API_TOKEN: undefined };
    try {
      parseWorkerEnv({ ...rest, OANDA_ACCOUNT_ID: "secret-ish-wrong-id" });
      expect.unreachable();
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain("DIRECT_URL: is missing");
      expect(msg).toContain("OANDA_API_TOKEN: is missing");
      expect(msg).toContain("OANDA_ACCOUNT_ID");
      expect(msg).not.toContain("secret-ish-wrong-id");
      expect(msg).not.toContain("fake-password");
    }
  });
});
