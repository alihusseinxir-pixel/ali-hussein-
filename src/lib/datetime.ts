/** Wall-clock <-> UTC conversion in a fixed IANA zone (no external deps). */

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "2026-10-07T16:00" (datetime-local) in `timeZone` -> Date. Returns null if empty/invalid. */
export function parseLocalDateTime(value: string | null | undefined, timeZone: string): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00"] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  let t = guess - offsetMs(new Date(guess), timeZone);
  t = guess - offsetMs(new Date(t), timeZone); // second pass handles DST edges
  const out = new Date(t);
  return Number.isNaN(out.getTime()) ? null : out;
}

/** Date -> "2026-10-07T16:00" for <input type="datetime-local">. */
export function toLocalInput(date: Date | null | undefined, timeZone: string): string {
  if (!date) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

export function formatDateTime(date: Date | null | undefined, timeZone: string): string {
  if (!date) return "—";
  // Arabic month names and am/pm, but Western digits (0-9) so dates match the rest of the numbers in the UI
  return new Intl.DateTimeFormat("ar-u-nu-latn", {
    timeZone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(date);
}
