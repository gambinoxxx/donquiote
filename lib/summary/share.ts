// "Ask Claude (chart + summary)": hands a chart picture and the summary text
// to the Claude app. The app itself never uploads the image or the text
// anywhere (invariant 9): on phones the OS share sheet passes both to the
// app DG picks; on desktop the text is copied and the PNG downloaded, then
// claude.ai opens. Browser calls are injected (`AskClaudeEnv`) so the
// fallbacks are testable without a browser.
import type { Pair } from "@/lib/types";

export const CLAUDE_URL = "https://claude.ai/new";

export type ChartTimeframeLabel = "D" | "4H" | "15m";

const TIMEFRAME_LABEL: Record<"D" | "H4" | "M15", ChartTimeframeLabel> = { D: "D", H4: "4H", M15: "15m" };
export const timeframeLabel = (tf: "D" | "H4" | "M15"): ChartTimeframeLabel => TIMEFRAME_LABEL[tf];

/** "donquixote-EURUSD-15m.png". */
export function chartFileName(pair: Pair, timeframe: ChartTimeframeLabel): string {
  return `donquixote-${pair.replace("_", "")}-${timeframe}.png`;
}

const captionTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "EUR/USD · 15m · Sun 8 Nov 2026 10:42 Lagos" (drawn on the picture). */
export function chartCaption(pair: Pair, timeframe: ChartTimeframeLabel, now: Date): string {
  const p = Object.fromEntries(captionTime.formatToParts(now).map((x) => [x.type, x.value]));
  return `${pair.replace("_", "/")} · ${timeframe} · ${p.weekday} ${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute} Lagos`;
}

/** The browser functions Ask Claude needs (real ones in components/ask-claude). */
export interface AskClaudeEnv {
  /** navigator.canShare({ files }) — false when the Web Share API can't take files (desktop). */
  canShareFiles(files: File[]): boolean;
  /** navigator.share — opens the OS share sheet. */
  share(data: { files: File[]; text: string; title: string }): Promise<void>;
  copyText(text: string): Promise<void>;
  /** Saves the file through the browser's download (never uploaded). */
  download(file: File): void;
  /** Opens claude.ai/new. */
  openClaude(): void;
  /** new File([blob], name, { type: "image/png" }). */
  toFile(blob: Blob, name: string): File;
}

export type AskClaudeOutcome =
  /** Share sheet opened and DG picked an app. */
  | { kind: "shared" }
  /** DG closed the share sheet: nothing else happens. */
  | { kind: "cancelled" }
  /** Desktop: text copied (or not) and the chart downloaded, Claude opened. */
  | { kind: "desktop"; copied: boolean }
  /** No picture (it failed or sharing failed): text only, Claude opened. */
  | { kind: "text-only"; copied: boolean };

/** A probe file to ask the browser whether it can share files at all. */
const PROBE = () => ({ name: "probe.png", blob: new Blob([], { type: "image/png" }) });

const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";

async function tryCopy(env: AskClaudeEnv, text: string): Promise<boolean> {
  try {
    await env.copyText(text);
    return true;
  } catch {
    return false;
  }
}

async function textOnly(env: AskClaudeEnv, text: string): Promise<AskClaudeOutcome> {
  const copied = await tryCopy(env, text);
  env.openClaude();
  return { kind: "text-only", copied };
}

/**
 * Picture + text to Claude. Phones (files can be shared): share sheet with
 * the PNG and the text. Desktop: copy text, download the PNG, open Claude.
 * Anything failing (picture or share) falls back to text only.
 */
export async function askClaudeWithChart(args: {
  text: string;
  fileName: string;
  /** Makes the PNG; may throw or return null (no chart). */
  makeImage: () => Promise<Blob | null>;
  env: AskClaudeEnv;
}): Promise<AskClaudeOutcome> {
  const { text, fileName, makeImage, env } = args;
  let canShare = false;
  try {
    const probe = PROBE();
    canShare = env.canShareFiles([env.toFile(probe.blob, probe.name)]);
  } catch {
    canShare = false;
  }

  if (canShare) {
    let file: File | null = null;
    try {
      const blob = await makeImage();
      file = blob ? env.toFile(blob, fileName) : null;
    } catch {
      file = null;
    }
    if (file && env.canShareFiles([file])) {
      try {
        await env.share({ files: [file], text, title: "Donquixote chart" });
        return { kind: "shared" };
      } catch (error) {
        if (isAbort(error)) return { kind: "cancelled" };
      }
    }
    return textOnly(env, text);
  }

  // Desktop: copy first, while the tap still counts as a user action.
  const copied = await tryCopy(env, text);
  try {
    const blob = await makeImage();
    if (!blob) throw new Error("no chart");
    env.download(env.toFile(blob, fileName));
  } catch {
    env.openClaude();
    return { kind: "text-only", copied };
  }
  env.openClaude();
  return { kind: "desktop", copied };
}

/** The toast after Ask Claude (null = nothing to say). */
export function askClaudeMessage(outcome: AskClaudeOutcome): string | null {
  switch (outcome.kind) {
    case "shared":
    case "cancelled":
      return null;
    case "desktop":
      return outcome.copied
        ? "Text copied and chart saved. Paste the text and attach the image."
        : "Chart saved, but the text couldn't be copied. Try again, then attach the image.";
    case "text-only":
      return outcome.copied ? "Chart picture failed. Text copied: paste it into Claude." : "Couldn't copy automatically. Try again.";
  }
}
