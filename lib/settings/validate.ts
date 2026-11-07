// Zod schema for a settings snapshot (what saveSettings accepts). Pure.
// Errors carry the field path (e.g. ["settings", "riskPct"]) so the screen
// can show them next to the field.
import { z } from "zod";
import type { SettingsSnapshot } from "./snapshot";

const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "XAU_USD"] as const;

const percent = (min: number, max: number, what: string) =>
  z.number({ error: `${what} must be a number` }).min(min, `${what}: at least ${min}%`).max(max, `${what}: at most ${max}%`);

const settingsSchema = z
  .object({
    accountSizeUsd: z.number({ error: "Account size must be a number" }).gt(0, "Account size must be above $0").max(100_000_000, "Account size looks too large"),
    startingBalanceUsd: z.number().gt(0, "Starting balance must be above $0"),
    riskPct: percent(0.1, 2, "Risk per trade"),
    rewardRatio: z.number().min(1, "Reward must be at least 1:1").max(10, "Reward at most 1:10"),
    dailyLossLimitPct: percent(0.5, 20, "Daily loss limit"),
    maxDrawdownPct: percent(1, 50, "Max drawdown"),
    warnDailyLossPct: percent(0.1, 20, "Daily warning"),
    stopDailyLossPct: percent(0.1, 20, "Done for the day"),
    warnOverallLossPct: percent(0.1, 50, "Overall warning"),
    maxTradesPerDay: z.number().int("Max trades per day must be a whole number").min(1, "At least 1 trade per day").max(20, "At most 20 trades per day"),
    // DG v1 numbers: sane ranges only.
    stopBufferPips: z.number().min(0, "Stop buffer can't be negative").max(20, "Stop buffer: at most 20 pips"),
    watchExpiryMinutes: z
      .number()
      .int("Expiry must be whole minutes")
      .min(15, "Expiry: at least 15 min")
      .max(1440, "Expiry: at most 24 h")
      .refine((v) => v % 15 === 0, "Expiry must be a multiple of 15 min (one candle)"),
    swingStrength: z.number().int("Swing strength must be a whole number").min(1, "Swing strength: at least 1").max(5, "Swing strength: at most 5"),
    equalTolerancePips: z.number().min(0.1, "Tolerance: at least 0.1 pip").max(10, "Tolerance: at most 10 pips"),
    paperTimeoutHours: z.number().int("Time limit must be whole hours").min(24, "Paper time limit: at least 24 h").max(168, "Paper time limit: at most 168 h"),
    pushEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    watchingPushEnabled: z.boolean(),
  })
  .superRefine((s, ctx) => {
    if (!(s.dailyLossLimitPct < s.maxDrawdownPct)) {
      ctx.addIssue({ code: "custom", path: ["dailyLossLimitPct"], message: "Daily loss limit must be below the max drawdown" });
    }
    if (!(s.warnDailyLossPct < s.dailyLossLimitPct)) {
      ctx.addIssue({ code: "custom", path: ["warnDailyLossPct"], message: "Daily warning must be below the daily loss limit" });
    }
    if (!(s.stopDailyLossPct < s.dailyLossLimitPct)) {
      ctx.addIssue({ code: "custom", path: ["stopDailyLossPct"], message: "Done-for-the-day must be below the daily loss limit" });
    }
    if (!(s.warnDailyLossPct < s.stopDailyLossPct)) {
      ctx.addIssue({ code: "custom", path: ["warnDailyLossPct"], message: "Daily warning must come before done-for-the-day" });
    }
    if (!(s.warnOverallLossPct < s.maxDrawdownPct)) {
      ctx.addIssue({ code: "custom", path: ["warnOverallLossPct"], message: "Overall warning must be below the max drawdown" });
    }
  });

export const snapshotSchema = z
  .object({
    settings: settingsSchema,
    watchlist: z
      .array(z.object({ pair: z.enum(PAIRS), enabled: z.boolean(), sortOrder: z.number().int() }))
      .refine((w) => new Set(w.map((x) => x.pair)).size === w.length, "A pair is listed twice")
      .refine((w) => w.some((x) => x.enabled), "Keep at least one pair on"),
    strategies: z
      .array(z.object({ strategyId: z.string().min(1).max(64), mode: z.enum(["LIVE", "TEST", "OFF"]) }))
      .refine((s) => new Set(s.map((x) => x.strategyId)).size === s.length, "A strategy is listed twice")
      .refine((s) => s.some((x) => x.mode === "LIVE"), "At least one strategy must stay Live."),
  });

export type ValidationResult =
  | { ok: true; snapshot: SettingsSnapshot }
  | { ok: false; errors: Array<{ path: string; message: string }> };

/** Checks every rule; errors keyed by dotted path ("settings.riskPct", "strategies"). */
export function validate(input: unknown): ValidationResult {
  const parsed = snapshotSchema.safeParse(input);
  if (parsed.success) return { ok: true, snapshot: parsed.data as SettingsSnapshot };
  return { ok: false, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}
