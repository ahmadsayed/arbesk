/**
 * Pure time helpers for the version time strip.
 * @remarks No DOM. Turns each version's save timestamp into the three things
 *   the strip draws: how wide the gap before a tick is, which local calendar
 *   day a tick belongs to, and the save-time label of the active version.
 *   A usable timestamp is a finite epoch-millisecond number or a string
 *   `Date` can parse; anything else is "undated".
 */

/** A run of consecutive versions saved on the same local calendar day. */
export interface TimelineDay {
  /** `Today`, `Yesterday`, `Fri 13 Nov`, or "" when the run is undated. */
  label: string;
  /** Index of the run's first version. */
  start: number;
  /** Index after the run's last version. */
  end: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MS_PER_MINUTE = 60_000;

/** @returns the timestamp as a Date, or null when it is not usable. */
function toDate(ts: unknown): Date | null {
  if (typeof ts !== "number" && typeof ts !== "string") return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** @returns whole local calendar days from `d` to `now` (negative = future). */
function daysBefore(d: Date, now: Date): number {
  const midnight = (x: Date) =>
    Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((midnight(now) - midnight(d)) / 86_400_000);
}

/** @returns `Today`, `Yesterday`, or `Fri 13 Nov` (with the year if not this one). */
function dayLabel(d: Date, now: Date): string {
  const age = daysBefore(d, now);
  if (age === 0) return "Today";
  if (age === 1) return "Yesterday";
  const dated = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear()
    ? dated
    : `${dated} ${d.getFullYear()}`;
}

/**
 * Relative width of the gap before each version.
 * @returns one weight per timestamp: `log(1 + minutes since the previous
 *   save)` to 3 decimals; 0 for the first version, for an undated neighbour,
 *   and for a save older than its predecessor.
 */
export function gapWeights(timestamps: unknown[]): number[] {
  const dates = timestamps.map(toDate);
  return dates.map((d, i) => {
    const prev = dates[i - 1];
    if (!d || !prev) return 0;
    const minutes = (d.getTime() - prev.getTime()) / MS_PER_MINUTE;
    return minutes > 0 ? Math.round(Math.log(1 + minutes) * 1000) / 1000 : 0;
  });
}

/**
 * Groups versions into runs saved on the same local calendar day.
 * @remarks An undated version never starts a run: it joins the run before it,
 *   or the first dated run when it leads the chain.
 */
export function splitDays(timestamps: unknown[], now: Date): TimelineDay[] {
  const dates = timestamps.map(toDate);
  const days: TimelineDay[] = [];
  // Day of the latest dated version so far; null until one is seen.
  let age: number | null = null;
  dates.forEach((d, i) => {
    const next = d ? daysBefore(d, now) : age;
    const last = days[days.length - 1];
    if (last && (next === age || age === null)) last.end = i + 1;
    else days.push({ label: "", start: i, end: i + 1 });
    age = next;
  });
  for (const day of days) {
    const first = dates.slice(day.start, day.end).find(Boolean);
    day.label = first ? dayLabel(first, now) : "";
  }
  return days;
}

/** @returns `Today 20:01`, `Fri 13 Nov 21:40`, or "" for an undated version. */
export function savedLabel(ts: unknown, now: Date): string {
  const d = toDate(ts);
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dayLabel(d, now)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
