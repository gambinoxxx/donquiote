// Minimal RSS 2.0 reader (pure) for the Fed and White House feeds: title,
// link, guid, pubDate and category per <item>. No dependency.

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string | null;
  category: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  if (!m) return null;
  let v = (m[1] ?? "").trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v);
  v = cdata ? (cdata[1] ?? "") : decodeEntities(v);
  v = v.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return v === "" ? null : v;
}

export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1] ?? "";
    const title = tag(block, "title");
    const link = tag(block, "link");
    if (!title || !link) continue;
    items.push({ title, link, guid: tag(block, "guid") ?? link, pubDate: tag(block, "pubDate"), category: tag(block, "category") });
  }
  return items;
}

/** RFC 822 date → ISO, or null. */
export function rssDate(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
