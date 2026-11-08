"use client";

// "Ask Claude (chart + summary)" — outlined amber, chat-bubble icon, full
// width. Phones: share sheet with the chart PNG + summary (pick the Claude
// app). Desktop: text copied, PNG downloaded, claude.ai opened. Any failure:
// text only. The app never uploads the picture.
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import type { Pair } from "@/lib/types";
import { askClaudeMessage, askClaudeWithChart, chartCaption, chartFileName, type ChartTimeframeLabel } from "@/lib/summary/share";
import { Spinner } from "@/components/spinner";
import { useToast } from "@/components/toast";
import { browserAskClaudeEnv, chartPng } from "./capture";

export function AskClaudeButton({
  summary,
  captureId,
  pair,
  timeframe,
}: {
  /** Summary text from lib/summary (built when the button is pressed, if a function). */
  summary: string | (() => string);
  /** Id the chart registered its screenshot under. */
  captureId: string;
  pair: Pair;
  timeframe: ChartTimeframeLabel;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function ask() {
    if (busy) return;
    setBusy(true);
    try {
      const text = typeof summary === "function" ? summary() : summary;
      const outcome = await askClaudeWithChart({
        text,
        fileName: chartFileName(pair, timeframe),
        makeImage: () => chartPng(captureId, chartCaption(pair, timeframe, new Date())),
        env: browserAskClaudeEnv(),
      });
      const message = askClaudeMessage(outcome);
      if (message) toast(message);
    } catch {
      toast("Couldn't open Claude. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={ask}
      disabled={busy}
      aria-busy={busy}
      className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-accent font-semibold text-accent disabled:opacity-70"
    >
      {busy ? <Spinner className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" aria-hidden="true" />}
      Ask Claude (chart + summary)
    </button>
  );
}
