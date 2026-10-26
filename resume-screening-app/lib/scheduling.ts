// Interview slot finding and fair sharing between Workforce Managers. Pure functions (no network),
// so they can be tested on their own. All instants are UTC; booking hours are wall-clock times in
// BOOKING_TIMEZONE.

export type Interval = { start: Date; end: Date };
export type Interviewer = { email: string; busy: Interval[] };
export type Slot = { start: Date; end: Date; free: string[] }; // free = interviewer emails

export type BookingRules = {
  timeZone: string; // IANA zone the booking hours are in, e.g. America/Chicago
  days: number[]; // 1 = Monday … 7 = Sunday
  startHour: number; // first slot starts at this hour (local)
  endHour: number; // last slot must end by this hour (local)
  minutes: number; // interview length
  bufferMinutes: number; // gap kept free before and after each interview
  minNoticeHours: number; // earliest slot = now + this
  daysAhead: number; // latest slot = today + this many days (unless lastDay is set)
  firstDay?: string; // YYYY-MM-DD in timeZone: no slots before this day (a ramp's Start Date)
  lastDay?: string; // YYYY-MM-DD in timeZone: no slots after this day (a ramp's End Date)
  maxPerDay?: number; // per interviewer per day (a ramp's limit)
};

// Most days a ramp's end date may reach, so a typo like 2062 can't build an endless list.
const MAX_DAYS = 120;

export const DEFAULT_RULES: BookingRules = {
  timeZone: "America/Chicago",
  days: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 17,
  minutes: 30,
  bufferMinutes: 15,
  minNoticeHours: 24,
  daysAhead: 14,
};

// Booking rules, with optional overrides from environment variables.
export function bookingRules(env: Record<string, string | undefined> = process.env): BookingRules {
  const num = (name: string, fallback: number) => {
    const n = Number(env[name]);
    return env[name] && Number.isFinite(n) ? n : fallback;
  };
  return {
    timeZone: env.BOOKING_TIMEZONE || DEFAULT_RULES.timeZone,
    days: env.BOOKING_DAYS ? env.BOOKING_DAYS.split(",").map(Number).filter((d) => d >= 1 && d <= 7) : DEFAULT_RULES.days,
    startHour: num("BOOKING_START_HOUR", DEFAULT_RULES.startHour),
    endHour: num("BOOKING_END_HOUR", DEFAULT_RULES.endHour),
    minutes: DEFAULT_RULES.minutes,
    bufferMinutes: num("BOOKING_BUFFER_MINUTES", DEFAULT_RULES.bufferMinutes),
    minNoticeHours: num("BOOKING_MIN_NOTICE_HOURS", DEFAULT_RULES.minNoticeHours),
    daysAhead: num("BOOKING_DAYS_AHEAD", DEFAULT_RULES.daysAhead),
  };
}

export type RampSettings = {
  timeZone?: string;
  hoursStart?: number;
  hoursEnd?: number;
  startDate?: string;
  endDate?: string;
  maxPerDay?: number;
};

// Booking rules for a ramp: its own settings where filled in, the defaults everywhere else.
export function rampRules(base: BookingRules, ramp: RampSettings): BookingRules {
  return {
    ...base,
    timeZone: ramp.timeZone || base.timeZone,
    startHour: ramp.hoursStart ?? base.startHour,
    endHour: ramp.hoursEnd ?? base.endHour,
    firstDay: ramp.startDate || undefined,
    lastDay: ramp.endDate || undefined,
    maxPerDay: ramp.maxPerDay || undefined,
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// ---- Time zone helpers (no libraries; uses the built-in time zone data) ----

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function zonedParts(date: Date, timeZone: string): Parts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday],
  };
}

// The UTC instant when the clock in `timeZone` shows the given wall time. Handles daylight saving
// by correcting twice (the offset can differ on either side of a change).
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - shown;
  }
  return new Date(guess);
}

// ---- Slots ----

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

// The calendar day (YYYY-MM-DD) an instant falls on in a time zone.
export function dayKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// Every slot in the booking window, with which interviewers are free for it (buffer included).
// Slots nobody is free for are left out. `booked` = interviews already booked per interviewer per
// day (dayKey), used for the ramp's daily limit.
export function findSlots(
  interviewers: Interviewer[],
  rules: BookingRules,
  now: Date = new Date(),
  booked: Record<string, Record<string, number>> = {},
): Slot[] {
  const earliest = new Date(now.getTime() + rules.minNoticeHours * 3_600_000);
  const lengthMs = rules.minutes * 60_000;
  const bufferMs = rules.bufferMinutes * 60_000;
  const today = zonedParts(now, rules.timeZone);
  const lastOffset = rules.lastDay ? MAX_DAYS : rules.daysAhead;
  const slots: Slot[] = [];

  for (let offset = 0; offset <= lastOffset; offset++) {
    // Walk calendar days in the booking time zone (noon avoids daylight-saving edge cases).
    const noon = zonedTimeToUtc(today.year, today.month, today.day + offset, 12, 0, rules.timeZone);
    const day = zonedParts(noon, rules.timeZone);
    const key = dayKey(noon, rules.timeZone);
    if (rules.lastDay && key > rules.lastDay) break;
    if (rules.firstDay && key < rules.firstDay) continue;
    if (!rules.days.includes(day.weekday)) continue;
    const available = interviewers.filter(
      (iv) => !rules.maxPerDay || (booked[iv.email]?.[key] ?? 0) < rules.maxPerDay,
    );

    for (let minute = rules.startHour * 60; minute + rules.minutes <= rules.endHour * 60; minute += rules.minutes) {
      const start = zonedTimeToUtc(day.year, day.month, day.day, Math.floor(minute / 60), minute % 60, rules.timeZone);
      if (start < earliest) continue;
      const slot = { start, end: new Date(start.getTime() + lengthMs) };
      const padded = { start: new Date(start.getTime() - bufferMs), end: new Date(slot.end.getTime() + bufferMs) };
      const free = available.filter((iv) => !iv.busy.some((b) => overlaps(padded, b))).map((iv) => iv.email);
      if (free.length) slots.push({ ...slot, free });
    }
  }
  return slots;
}

export type DaySummary = { day: string; times: number; first: Date; last: Date; perInterviewer: Record<string, number> };

// Open spots grouped by day, for the ramp page: how many times a candidate could pick, and how many
// of those each interviewer is free for.
export function summarizeByDay(slots: Slot[], timeZone: string): DaySummary[] {
  const days = new Map<string, DaySummary>();
  for (const s of slots) {
    const key = dayKey(s.start, timeZone);
    const d = days.get(key) ?? { day: key, times: 0, first: s.start, last: s.start, perInterviewer: {} };
    d.times += 1;
    if (s.start < d.first) d.first = s.start;
    if (s.start > d.last) d.last = s.start;
    for (const email of s.free) d.perInterviewer[email] = (d.perInterviewer[email] ?? 0) + 1;
    days.set(key, d);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// Picks who gets the interview: the free person with the fewest upcoming interviews.
// Ties go to whoever has gone longest without one, then alphabetically, so it's predictable.
export function pickInterviewer(
  free: string[],
  upcoming: Record<string, number>,
  lastBooked: Record<string, number> = {},
): string | null {
  if (!free.length) return null;
  return [...free].sort(
    (a, b) =>
      (upcoming[a] ?? 0) - (upcoming[b] ?? 0) ||
      (lastBooked[a] ?? 0) - (lastBooked[b] ?? 0) ||
      a.localeCompare(b),
  )[0];
}

// True if `email` is still free for the slot, given busy times fetched just before booking.
export function stillFree(busy: Interval[], slot: Interval, bufferMinutes: number): boolean {
  const bufferMs = bufferMinutes * 60_000;
  const padded = { start: new Date(slot.start.getTime() - bufferMs), end: new Date(slot.end.getTime() + bufferMs) };
  return !busy.some((b) => overlaps(padded, b));
}
