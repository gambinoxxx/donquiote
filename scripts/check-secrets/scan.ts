// Pure scan for `npm run check:secrets`: server-only variable names (and,
// when they are set, their values) must never appear in browser files.
// Findings carry the variable name and file only, never a value.

/** Name prefixes / names that are server-only. NEXT_PUBLIC_* are fine. */
export const SERVER_ONLY_NAMES = [
  "OANDA_",
  "DATABASE_URL",
  "DIRECT_URL",
  "CLERK_SECRET",
  "VAPID_PRIVATE",
  "RESEND_",
  "FINNHUB_",
  "ANTHROPIC_",
  "CRON_SECRET",
] as const;

export interface Finding {
  file: string;
  /** The variable name (or name pattern) found. */
  name: string;
  kind: "name" | "value";
}

/** Server-only env values worth looking for (long enough not to match by chance). */
export function secretValues(env: Readonly<Record<string, string | undefined>>): Array<{ name: string; value: string }> {
  return Object.entries(env)
    .filter(([name, value]) => !name.startsWith("NEXT_PUBLIC_") && SERVER_ONLY_NAMES.some((p) => name.startsWith(p)) && typeof value === "string" && value.length >= 12)
    .map(([name, value]) => ({ name, value: value as string }));
}

/**
 * Known third-party reads that carry no value: @clerk/nextjs's shared
 * constants module reads `process.env.CLERK_SECRET_KEY` (and the machine
 * key) in the browser too, where `process.env` is empty (Next.js only
 * inlines NEXT_PUBLIC_*). Only this exact property read, and only in a
 * file that is Clerk's constants module, is ignored; the value check still
 * runs on the file.
 */
const IGNORED: ReadonlyArray<{ marker: string; read: RegExp; reason: string }> = [
  {
    marker: "NEXT_PUBLIC_CLERK_JS_VERSION",
    read: /\.env\.CLERK_(?:MACHINE_)?SECRET_KEY\b/g,
    reason: "Clerk library reads an empty browser process.env",
  },
];

export interface ScanResult {
  findings: Finding[];
  ignored: Array<{ file: string; reason: string }>;
}

export function scanText(file: string, text: string, values: ReadonlyArray<{ name: string; value: string }>): Finding[] {
  return scanFile(file, text, values).findings;
}

export function scanFile(file: string, input: string, values: ReadonlyArray<{ name: string; value: string }>): ScanResult {
  const out: Finding[] = [];
  const ignored: ScanResult["ignored"] = [];
  let text = input;
  for (const rule of IGNORED) {
    if (text.includes(rule.marker) && rule.read.test(text)) {
      ignored.push({ file, reason: rule.reason });
      text = text.replace(rule.read, ".env.IGNORED");
    }
    rule.read.lastIndex = 0;
  }
  for (const name of SERVER_ONLY_NAMES) {
    // A name counts unless it is part of NEXT_PUBLIC_<name>.
    const re = new RegExp(`(?<![A-Z0-9_])${name}`, "g");
    if (re.test(text)) out.push({ file, name, kind: "name" });
  }
  for (const v of values) if (input.includes(v.value)) out.push({ file, name: v.name, kind: "value" });
  return { findings: out, ignored };
}
