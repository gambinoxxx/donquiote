// When the prop firm's trading day starts, in any time zone (DST-safe via
// Intl). Pure.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock time of `date` in `timeZone`, encoded as if it were UTC. */
function wallMs(date: Date, timeZone: string): number {
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(date)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
}

/** The real instant whose wall time in `timeZone` is `wall` (earliest if repeated). */
function fromWallMs(wall: number, timeZone: string): Date {
  const guess = wall - (wallMs(new Date(wall), timeZone) - wall);
  const candidates = [-HOUR_MS, 0, HOUR_MS]
    .map((shift) => guess + shift)
    .filter((t) => wallMs(new Date(t), timeZone) === wall)
    .sort((a, b) => a - b);
  return new Date(candidates[0] ?? guess);
}

/** True if `timeZone` is a valid IANA zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start of the prop firm's current trading day: the latest `resetHour`:00 in
 * `timeZone` at or before `now`. E.g. 17:00 New York → 22:00 UTC in winter,
 * 21:00 UTC in summer.
 */
export function propDayStart(now: Date, timeZone: string, resetHour: number): Date {
  const wall = wallMs(now, timeZone);
  const d = new Date(wall);
  let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), resetHour);
  if (start > wall) start -= DAY_MS;
  return fromWallMs(start, timeZone);
}
