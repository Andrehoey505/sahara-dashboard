/**
 * One place that turns a timestamp from the bot into text on screen.
 *
 * Timestamps arrive from several places and in several shapes: the bot writes
 * ISO 8601 with an offset, some older records carry a trailing Z, and a few
 * fields are bare dates. Screens each formatted their own way, so the same
 * moment could read "12 Nov, 17:41" on one page and "11/12/2026" on another, and
 * a value the browser could not parse rendered as "Invalid Date" rather than
 * saying nothing.
 *
 * Everything here goes through the same parser and the same locale (en-GB, the
 * user's), so a time looks the same wherever it appears.
 */

/** Parse a timestamp to a Date, or null if it is not one. */
export function parseTime(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    // Seconds or milliseconds — a bare 10-digit number is seconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const s = value.trim();
  // A timestamp with no zone is UTC from this bot — every writer uses
  // datetime.now(timezone.utc). Left alone, the browser would read it as local
  // and every time would be out by an hour or more.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const d = new Date(hasZone ? s : `${s}Z`);
  return isNaN(d.getTime()) ? null : d;
}

/** "12 Nov 2026, 17:41" — the full form, for a detail line. */
export function formatDateTime(value: unknown): string {
  const d = parseTime(value);
  if (!d) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "12 Nov, 17:41" — for a list, where the year is usually obvious. */
export function formatShort(value: unknown): string {
  const d = parseTime(value);
  if (!d) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "17:41" — for a line inside a conversation. */
export function formatClock(value: unknown): string {
  const d = parseTime(value);
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "just now", "4m ago", "3h ago", "2d ago", then the date. */
export function formatAgo(value: unknown): string {
  const d = parseTime(value);
  if (!d) return "";
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  // A clock slightly ahead of the browser's should read as now, not "in -1m".
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return formatShort(value);
}

/** The full moment, for a title attribute. Empty when unparseable. */
export function formatTitle(value: unknown): string | undefined {
  const d = parseTime(value);
  if (!d) return undefined;
  return d.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "medium" });
}
