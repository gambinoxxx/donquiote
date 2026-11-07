import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireAllowedUser = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAllowedUser: () => requireAllowedUser() }));
const saveSnapshot = vi.fn();
vi.mock("./settings-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settings-store")>()),
  saveSnapshot: (...args: unknown[]) => saveSnapshot(...args),
}));
const findUnique = vi.fn();
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ settingsVersion: { findUnique } }) }));

const { restoreSettings, saveSettings, setPairEnabled, setStrategyMode } = await import("./settings-actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireAllowedUser.mockResolvedValue({ userId: "u", email: "dg@example.com" });
  saveSnapshot.mockResolvedValue({ ok: true, versionId: "v2", changes: [] });
});

describe("settings actions", () => {
  it.each([
    ["saveSettings", () => saveSettings({}, "v1")],
    ["setStrategyMode", () => setStrategyMode("dg-v1", "TEST", "v1")],
    ["setPairEnabled", () => setPairEnabled("EUR_USD", false, "v1")],
    ["restoreSettings", () => restoreSettings("v0", "v1")],
  ])("%s refuses users who are not allowed and writes nothing", async (_name, call) => {
    requireAllowedUser.mockRejectedValue(new Error("This email is not allowed to use the app"));
    await expect(call()).rejects.toThrow(/not allowed/);
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it("saveSettings passes the signed-in email and base version", async () => {
    await saveSettings({ some: "snapshot" }, "v1");
    expect(saveSnapshot).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ email: "dg@example.com", baseVersionId: "v1" }));
  });

  it("setStrategyMode and setPairEnabled change one field of the current state", async () => {
    await setStrategyMode("gemini-fvg", "LIVE", "v1");
    const build = saveSnapshot.mock.calls[0]?.[1].build as (c: unknown) => { strategies: Array<{ strategyId: string; mode: string }> };
    const current = { settings: {}, watchlist: [], strategies: [{ strategyId: "dg-v1", mode: "LIVE" }, { strategyId: "gemini-fvg", mode: "TEST" }] };
    expect(build(current).strategies).toEqual([{ strategyId: "dg-v1", mode: "LIVE" }, { strategyId: "gemini-fvg", mode: "LIVE" }]);

    await setPairEnabled("EUR_USD", false, "v2");
    const build2 = saveSnapshot.mock.calls[1]?.[1].build as (c: unknown) => { watchlist: Array<{ pair: string; enabled: boolean }> };
    expect(build2({ settings: {}, strategies: [], watchlist: [{ pair: "EUR_USD", enabled: true, sortOrder: 1 }] }).watchlist).toEqual([
      { pair: "EUR_USD", enabled: false, sortOrder: 1 },
    ]);
  });

  it("rejects bad input before saving", async () => {
    expect(await setStrategyMode("dg-v1", "MAYBE", "v1")).toMatchObject({ ok: false });
    expect(await setPairEnabled("BTC_USD", true, "v1")).toMatchObject({ ok: false });
    expect(await saveSettings({}, 42)).toMatchObject({ ok: false });
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it("restoreSettings sets restoredFromId; an unknown version is refused", async () => {
    findUnique.mockResolvedValueOnce({ id: "v0", snapshot: { settings: {}, watchlist: [], strategies: [] } });
    await restoreSettings("v0", "v1");
    expect(saveSnapshot.mock.calls[0]?.[1]).toMatchObject({ restoredFromId: "v0", baseVersionId: "v1" });
    findUnique.mockResolvedValueOnce(null);
    expect(await restoreSettings("nope", "v1")).toEqual({ ok: false, error: "That version no longer exists." });
  });
});
