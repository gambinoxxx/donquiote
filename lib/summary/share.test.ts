import { describe, expect, it, vi } from "vitest";
import { askClaudeMessage, askClaudeWithChart, chartCaption, chartFileName, timeframeLabel, type AskClaudeEnv } from "./share";

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

function env(opts: { canShare: boolean; share?: () => Promise<void>; copy?: () => Promise<void> }) {
  const calls: string[] = [];
  const e: AskClaudeEnv & { calls: string[]; shared: Array<{ files: File[]; text: string }>; downloaded: File[] } = {
    calls,
    shared: [],
    downloaded: [],
    canShareFiles: () => opts.canShare,
    share: vi.fn(async (data) => {
      calls.push("share");
      e.shared.push(data);
      await (opts.share ?? (async () => {}))();
    }),
    copyText: vi.fn(async () => {
      calls.push("copy");
      await (opts.copy ?? (async () => {}))();
    }),
    download: vi.fn((file: File) => {
      calls.push("download");
      e.downloaded.push(file);
    }),
    openClaude: vi.fn(() => {
      calls.push("open");
    }),
    toFile: (blob, name) => new File([blob], name, { type: "image/png" }),
  };
  return e;
}

const run = (e: AskClaudeEnv, makeImage: () => Promise<Blob | null> = async () => PNG) =>
  askClaudeWithChart({ text: "EUR/USD SELL summary", fileName: "donquixote-EURUSD-15m.png", makeImage, env: e });

describe("Ask Claude (chart + summary)", () => {
  it("file name and caption", () => {
    expect(chartFileName("EUR_USD", "15m")).toBe("donquixote-EURUSD-15m.png");
    expect(chartFileName("USD_JPY", timeframeLabel("H4"))).toBe("donquixote-USDJPY-4H.png");
    // 09:42 UTC = 10:42 Lagos.
    expect(chartCaption("EUR_USD", "15m", new Date("2026-11-08T09:42:00Z"))).toBe("EUR/USD · 15m · Sun 8 Nov 2026 10:42 Lagos");
  });

  it("phones: one share sheet with the PNG and the text; Claude is not opened by the app", async () => {
    const e = env({ canShare: true });
    expect(await run(e)).toEqual({ kind: "shared" });
    expect(e.calls).toEqual(["share"]);
    expect(e.shared[0]!.text).toBe("EUR/USD SELL summary");
    expect(e.shared[0]!.files[0]!.name).toBe("donquixote-EURUSD-15m.png");
    expect(e.shared[0]!.files[0]!.type).toBe("image/png");
  });

  it("phones: closing the share sheet does nothing else", async () => {
    const e = env({ canShare: true, share: () => Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" })) });
    expect(await run(e)).toEqual({ kind: "cancelled" });
    expect(e.calls).toEqual(["share"]);
    expect(askClaudeMessage({ kind: "cancelled" })).toBeNull();
  });

  it("phones: share failing falls back to text only", async () => {
    const e = env({ canShare: true, share: () => Promise.reject(new Error("NotAllowedError")) });
    expect(await run(e)).toEqual({ kind: "text-only", copied: true });
    expect(e.calls).toEqual(["share", "copy", "open"]);
  });

  it("phones: picture failing falls back to text only (no share sheet)", async () => {
    const e = env({ canShare: true });
    expect(await run(e, () => Promise.reject(new Error("canvas tainted")))).toEqual({ kind: "text-only", copied: true });
    expect(e.calls).toEqual(["copy", "open"]);
    const noChart = env({ canShare: true });
    expect(await run(noChart, async () => null)).toEqual({ kind: "text-only", copied: true });
  });

  it("desktop: copies the text, downloads the PNG, then opens Claude", async () => {
    const e = env({ canShare: false });
    const outcome = await run(e);
    expect(outcome).toEqual({ kind: "desktop", copied: true });
    expect(e.calls).toEqual(["copy", "download", "open"]);
    expect(e.downloaded[0]!.name).toBe("donquixote-EURUSD-15m.png");
    expect(askClaudeMessage(outcome)).toBe("Text copied and chart saved. Paste the text and attach the image.");
  });

  it("desktop: picture failing falls back to text only", async () => {
    const e = env({ canShare: false });
    const outcome = await run(e, () => Promise.reject(new Error("toBlob failed")));
    expect(outcome).toEqual({ kind: "text-only", copied: true });
    expect(e.calls).toEqual(["copy", "open"]);
    expect(askClaudeMessage(outcome)).toBe("Chart picture failed. Text copied: paste it into Claude.");
  });

  it("desktop: clipboard blocked still saves the picture and says so", async () => {
    const e = env({ canShare: false, copy: () => Promise.reject(new Error("denied")) });
    const outcome = await run(e);
    expect(outcome).toEqual({ kind: "desktop", copied: false });
    expect(askClaudeMessage(outcome)).toContain("couldn't be copied");
  });

  it("a browser whose canShare throws is treated as desktop", async () => {
    const e = env({ canShare: false });
    e.canShareFiles = () => {
      throw new TypeError("canShare not supported");
    };
    expect((await run(e)).kind).toBe("desktop");
  });

  it("never uploads: the flow only uses the injected share / clipboard / download / open", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await run(env({ canShare: true }));
    await run(env({ canShare: false }));
    await run(env({ canShare: false }), () => Promise.reject(new Error("x")));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
