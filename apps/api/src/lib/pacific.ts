/**
 * The Gemini free tier resets its requests-per-day quota at midnight Pacific.
 * User credits follow the same clock, so a user's allowance and the shared
 * quota they draw from refresh at the same instant and nothing is wasted.
 */

const PACIFIC = "America/Los_Angeles";

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour") % 24, value("minute"), value("second"));
  return asUtc - date.getTime();
}

/** The calendar date in Pacific time, as `YYYY-MM-DD`. */
export function pacificDayKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** The instant of midnight Pacific that starts the day containing `now`. */
export function pacificDayStart(now: Date = new Date()): Date {
  const parts = pacificDayKey(now).split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error("Could not work out the Pacific calendar date.");
  }
  // Start from the UTC date, then correct for the zone offset at that moment.
  let guess = Date.UTC(year, month - 1, day, 8);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = timeZoneOffsetMs(new Date(guess), PACIFIC);
    guess = Date.UTC(year, month - 1, day) - offset;
  }
  return new Date(guess);
}

/** The instant of midnight Pacific that starts the next day. */
export function pacificDayEnd(now: Date = new Date()): Date {
  return new Date(pacificDayStart(now).getTime() + 24 * 60 * 60 * 1000);
}

/** A short human phrase for how long the current allowance lasts. */
export function describeReset(now: Date = new Date()): string {
  const end = pacificDayEnd(now);
  const hours = Math.max(0, Math.round((end.getTime() - now.getTime()) / 3_600_000));
  if (hours <= 1) return "in under an hour";
  if (hours < 24) return `in ${hours} hours`;
  return "tomorrow";
}
