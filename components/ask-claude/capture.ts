// Browser helpers for "Ask Claude (chart + summary)". The chart registers a
// screenshot function under an id (the chart page uses "chart", Alert detail
// the alert id); the button asks for it. Lightweight Charts'
// takeScreenshot() includes the price (level) lines; we add a caption band
// on top (pair, timeframe, time in Lagos). Nothing here uploads anything.
import { CLAUDE_URL, type AskClaudeEnv } from "@/lib/summary/share";

type Screenshot = () => HTMLCanvasElement;
const captures = new Map<string, Screenshot>();

/** Registers a chart's screenshot function; returns the unregister function. */
export function registerChartCapture(id: string, take: Screenshot): () => void {
  captures.set(id, take);
  return () => {
    if (captures.get(id) === take) captures.delete(id);
  };
}

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const CAPTION_PX = 28;

/** The registered chart as a PNG with a caption band, or null if no chart is shown. */
export async function chartPng(id: string, caption: string): Promise<Blob | null> {
  const take = captures.get(id);
  if (!take) return null;
  const shot = take();
  if (shot.width === 0 || shot.height === 0) return null;
  const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const band = CAPTION_PX * scale;
  const canvas = document.createElement("canvas");
  canvas.width = shot.width;
  canvas.height = shot.height + band;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  // The chart background is transparent: paint the page colour under it.
  ctx.fillStyle = token("--bg-base", "#0E1116");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = token("--text-muted", "#9AA3AE");
  ctx.font = `600 ${13 * scale}px ${getComputedStyle(document.body).fontFamily || "sans-serif"}`;
  ctx.textBaseline = "middle";
  ctx.fillText(caption, 10 * scale, band / 2);
  ctx.drawImage(shot, 0, band);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}

/** The real browser functions. */
export function browserAskClaudeEnv(): AskClaudeEnv {
  return {
    canShareFiles: (files) => typeof navigator.canShare === "function" && typeof navigator.share === "function" && navigator.canShare({ files }),
    share: (data) => navigator.share(data),
    copyText: (text) => navigator.clipboard.writeText(text),
    download(file) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    openClaude() {
      const tab = window.open(CLAUDE_URL, "_blank", "noopener");
      if (!tab) window.location.assign(CLAUDE_URL);
    },
    toFile: (blob, name) => new File([blob], name, { type: "image/png" }),
  };
}
