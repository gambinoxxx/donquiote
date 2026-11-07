"use client";

// Client parts of the alert screen: copy buttons, Ask Claude, and the
// Skip / "I took this trade" decision with a confirm sheet.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, MessageCircle } from "lucide-react";
import { markSkipped, markTaken } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useToast } from "@/components/toast";

const CLAUDE_URL = "https://claude.ai/new";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** One ticket cell with a copy button (copies the plain value). */
export function TicketCell({
  label,
  value,
  copy,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  /** Text to copy; defaults to the value. Null = no copy button. */
  copy?: string | null;
  tone?: "buy" | "sell";
  highlight?: boolean;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const text = copy === undefined ? value : copy;
  return (
    <div className={cn("relative flex min-w-0 flex-col gap-[3px] rounded-[10px] p-3", highlight ? "bg-warn" : "bg-base")}>
      <span className={cn("text-xs", highlight ? "text-accent-soft" : "text-muted")}>{label}</span>
      <span
        className={cn(
          "truncate font-mono text-[15px] font-semibold",
          highlight && "font-bold text-accent",
          tone === "buy" && "text-buy",
          tone === "sell" && "text-sell",
        )}
      >
        {value}
      </span>
      {text !== null && (
        <button
          type="button"
          aria-label={`Copy ${label.split(" · ")[0]?.toLowerCase()} ${text}`}
          onClick={async () => {
            if (await copyText(text)) {
              setCopied(true);
              toast(`Copied ${text}`);
              setTimeout(() => setCopied(false), 1500);
            } else {
              toast("Couldn't copy. Long-press the value instead.");
            }
          }}
          className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted active:bg-pressed"
        >
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

/** Copies the summary, opens Claude in a new tab and confirms with a toast. */
export function AskClaudeButton({ summary }: { summary: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={async () => {
        // Open first, inside the tap, so popup blockers allow it.
        const tab = window.open(CLAUDE_URL, "_blank", "noopener");
        const ok = await copyText(summary);
        toast(ok ? "Copied — paste it into Claude" : "Couldn't copy automatically. Try again from this page.");
        if (!tab && ok) window.location.assign(CLAUDE_URL);
      }}
      className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-accent font-semibold text-accent"
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      Ask Claude
    </button>
  );
}

/** Skip / "I took this trade" (READY only), each confirmed in a bottom sheet. */
export function DecisionBar({ alertId, pairText }: { alertId: string; pairText: string }) {
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<"skip" | "take" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!sheet) return;
    setPending(true);
    setError(null);
    try {
      const result = sheet === "skip" ? await markSkipped(alertId) : await markTaken(alertId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast(sheet === "skip" ? "Skipped" : "Added to your Journal");
      setSheet(null);
      router.refresh();
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => setSheet("skip")}
          className="h-[52px] flex-1 rounded-xl border border-input font-semibold"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => setSheet("take")}
          className="h-[52px] flex-[2] rounded-xl bg-accent font-bold text-on-accent"
        >
          I took this trade
        </button>
      </div>
      <ConfirmSheet
        open={sheet !== null}
        title={sheet === "skip" ? `Skip this ${pairText} alert?` : `Log this ${pairText} trade?`}
        confirmLabel={sheet === "skip" ? "Skip alert" : "Yes, I took it"}
        pending={pending}
        onConfirm={confirm}
        onCancel={() => {
          setSheet(null);
          setError(null);
        }}
      >
        <p>
          {sheet === "skip"
            ? "It moves to Skipped. The paper trade keeps running either way."
            : "It moves to Taken and starts a Journal entry with this ticket. You log the result later."}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-error">
            {error}
          </p>
        )}
      </ConfirmSheet>
    </>
  );
}
