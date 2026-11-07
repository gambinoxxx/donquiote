// Near-identical titles across sources (pure): the same story from two
// feeds is stored once.
const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "at", "by", "with", "as", "is", "are", "be", "from", "says", "said"]);

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9%.]+/g, " ")
      .split(" ")
      .map((w) => w.replace(/^\.+|\.+$/g, ""))
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Jaccard similarity of the two titles' word sets (0–1). */
export function titleSimilarity(a: string, b: string): number {
  const x = titleTokens(a);
  const y = titleTokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

export const DUPLICATE_SIMILARITY = 0.8;

export function isNearDuplicate(title: string, others: readonly string[]): boolean {
  return others.some((o) => titleSimilarity(title, o) >= DUPLICATE_SIMILARITY);
}
