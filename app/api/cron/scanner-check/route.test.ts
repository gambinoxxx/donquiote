import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "c".repeat(48);
let cronSecret: string | null = SECRET;
const checkScanner = vi.fn(async () => ({ action: "none", state: "ok", reason: "last OK scan is recent", sent: null, problems: [] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ cronSecret }) }));
vi.mock("@/lib/data/cron", async () => {
  const { isAuthorized } = await import("@/lib/data/scanner-alarm");
  return { isCronAuthorized: isAuthorized, checkScanner };
});
const { GET } = await import("./route");

const call = (auth?: string) => GET(new Request("https://app.example/api/cron/scanner-check", { headers: auth ? { authorization: auth } : {} }));

describe("GET /api/cron/scanner-check", () => {
  beforeEach(() => {
    cronSecret = SECRET;
    checkScanner.mockClear();
  });
  it("401 without or with a wrong bearer token, and never runs the check", async () => {
    for (const auth of [undefined, "Bearer wrong", SECRET, `Basic ${SECRET}`]) {
      const res = await call(auth);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: "Unauthorized" });
      expect(JSON.stringify(body)).not.toContain(SECRET);
    }
    expect(checkScanner).not.toHaveBeenCalled();
  });
  it("503 when CRON_SECRET is not set (even with a header)", async () => {
    cronSecret = null;
    expect((await call("Bearer anything")).status).toBe(503);
    expect(checkScanner).not.toHaveBeenCalled();
  });
  it("200 with the right token runs one check", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { state: "ok" } });
    expect(checkScanner).toHaveBeenCalledTimes(1);
  });
});
