// AI fallback for headlines the keyword rules can't decide (worker only).
// Only when ANTHROPIC_API_KEY is set. Sends the headline title and nothing
// else (no personal data); a small, cheap model; no retries; the caller
// adds the daily cap and a timeout and falls back to NORMAL on any failure.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { AI_TIMEOUT_MS, type AiClassifier } from "@/lib/news/classify";

export const AI_MODEL = "claude-haiku-5-5";

const Verdict = z.object({
  impact: z.enum(["HIGH", "NORMAL"]),
  currencies: z.array(z.enum(["USD", "EUR", "GBP", "JPY", "CAD", "CHF"])),
  reason: z.string(),
});

const SYSTEM = [
  "You classify one news headline for a forex trader who trades EUR/USD, GBP/USD, USD/JPY, USD/CAD and USD/CHF.",
  "HIGH means it can move those currencies sharply within minutes: central bank decisions or surprise statements,",
  "US presidential or White House actions on tariffs, trade, sanctions, the Fed, rates or the dollar, currency",
  "interventions, government shutdowns or debt defaults, major geopolitical shocks. Everything else is NORMAL.",
  "List only the affected currencies from USD, EUR, GBP, JPY, CAD, CHF. Reason: one short sentence.",
].join(" ");

export function createAiClassifier(apiKey: string): AiClassifier {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: AI_TIMEOUT_MS });
  return {
    async classify(title) {
      const res = await client.messages.parse({
        model: AI_MODEL,
        max_tokens: 300,
        thinking: { type: "disabled" },
        output_config: { effort: "low", format: zodOutputFormat(Verdict) },
        system: SYSTEM,
        messages: [{ role: "user", content: `Headline: ${title.slice(0, 300)}` }],
      });
      if (res.stop_reason === "refusal") return null;
      return res.parsed_output ?? null;
    },
  };
}
