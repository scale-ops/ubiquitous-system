// Checks what a recruiter typed for a ramp before it's saved, and works out a ramp's open spots.
import {
  RAMP_STATUSES,
  listActiveWorkforceManagers,
  upcomingInterviews,
  type Ramp,
  type RampInput,
  type TeamMember,
  type UpcomingInterview,
} from "./airtable";
import { freeBusy, testMode, type FreeBusyResult } from "./google";
import {
  bookingRules,
  dayKey,
  findSlots,
  isValidTimeZone,
  rampRules,
  summarizeByDay,
  zonedTimeToUtc,
  type BookingRules,
  type Interviewer,
  type Slot,
} from "./scheduling";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Returns a clean RampInput, or throws an Error whose message is shown to the recruiter.
export function validateRamp(body: Record<string, unknown>, activeIds: Set<string>, partial = false): Partial<RampInput> {
  const out: Partial<RampInput> = {};
  const has = (k: string) => body[k] !== undefined;

  if (!partial || has("name")) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("Give the ramp a name, for example QA Aether Ramp 10.25.2026.");
    if (name.length > 120) throw new Error("The ramp name is too long (120 characters at most).");
    out.name = name;
  }
  if (!partial || has("interviewerIds")) {
    const ids = Array.isArray(body.interviewerIds) ? body.interviewerIds.map(String) : [];
    const unknown = ids.filter((id) => !activeIds.has(id));
    if (unknown.length) throw new Error("Some interviewers aren't Active Workforce Managers in Internal Team.");
    out.interviewerIds = [...new Set(ids)];
  }
  if (!partial || has("jobId")) out.jobId = body.jobId ? String(body.jobId) : null;
  if (!partial || has("status")) {
    const status = String(body.status ?? "Planning");
    if (!(RAMP_STATUSES as readonly string[]).includes(status)) throw new Error("Status must be Planning, Open or Closed.");
    out.status = status as RampInput["status"];
  }
  for (const key of ["startDate", "endDate"] as const) {
    if (!partial || has(key)) {
      const v = String(body[key] ?? "").trim();
      if (v && !DATE.test(v)) throw new Error("Dates must look like 2026-10-25.");
      out[key] = v;
    }
  }
  if (out.startDate && out.endDate && out.endDate < out.startDate) throw new Error("The end date is before the start date.");
  for (const key of ["hoursStart", "hoursEnd", "maxPerDay"] as const) {
    if (!partial || has(key)) {
      const raw = body[key];
      if (raw === null || raw === "" || raw === undefined) {
        out[key] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new Error("Hours and the daily limit must be whole numbers.");
      if (key === "maxPerDay" && n < 1) throw new Error("The daily limit must be at least 1.");
      if (key !== "maxPerDay" && (n < 0 || n > 24)) throw new Error("Hours must be between 0 and 24.");
      out[key] = n;
    }
  }
  if (out.hoursStart != null && out.hoursEnd != null && out.hoursEnd <= out.hoursStart) {
    throw new Error("Booking hours must end after they start.");
  }
  if (!partial || has("timeZone")) {
    const tz = String(body.timeZone ?? "").trim();
    if (tz && !isValidTimeZone(tz)) throw new Error(`"${tz}" isn't a time zone the hub knows. Try e.g. America/Mexico_City.`);
    out.timeZone = tz;
  }
  if (!partial || has("notes")) out.notes = String(body.notes ?? "").slice(0, 5000);
  return out;
}

export type RampAvailability = {
  testMode: boolean;
  timeZone: string;
  hours: string;
  window: { from: string; to: string };
  interviewers: { id: string; name: string; email: string; canSee: boolean; problem: string | null }[];
  days: { day: string; times: number; first: string; last: string; perInterviewer: Record<string, number> }[];
};

// Open interview spots for a ramp: reads its interviewers' calendars and applies its rules.
// Booking rules for a ramp (or the defaults when there's no ramp).
export function rulesForRamp(ramp: Ramp | null): BookingRules {
  if (!ramp) return bookingRules();
  return rampRules(bookingRules(), {
    timeZone: ramp.timeZone,
    hoursStart: ramp.hoursStart ?? undefined,
    hoursEnd: ramp.hoursEnd ?? undefined,
    startDate: ramp.startDate,
    endDate: ramp.endDate,
    maxPerDay: ramp.maxPerDay ?? undefined,
  });
}

// Last day of the booking window, as YYYY-MM-DD in the rules' time zone.
export function lastWindowDay(rules: BookingRules, now: Date): string {
  return rules.lastDay ?? dayKey(new Date(now.getTime() + rules.daysAhead * 86_400_000), rules.timeZone);
}

export type SlotResult = {
  slots: Slot[];
  busyByEmail: Map<string, FreeBusyResult>;
  upcoming: UpcomingInterview[];
};

// Reads the interviewers' calendars and booked interviews, then lists the open slots.
export async function computeSlots(rules: BookingRules, members: TeamMember[], now: Date): Promise<SlotResult> {
  const [y, m, d] = lastWindowDay(rules, now).split("-").map(Number);
  const windowEnd = zonedTimeToUtc(y, m, d + 1, 0, 0, rules.timeZone);
  const [busy, upcoming] = await Promise.all([
    windowEnd > now && members.length
      ? freeBusy(members.map((c) => c.email), now.toISOString(), windowEnd.toISOString())
      : Promise.resolve([] as FreeBusyResult[]),
    upcomingInterviews(),
  ]);
  const busyByEmail = new Map(busy.map((b) => [b.email, b]));

  // Interviews already booked per interviewer per day, for the daily limit.
  const emailOf = new Map(members.map((mm) => [mm.id, mm.email]));
  const booked: Record<string, Record<string, number>> = {};
  for (const iv of upcoming) {
    for (const id of iv.interviewerIds) {
      const email = emailOf.get(id);
      if (!email) continue;
      const key = dayKey(iv.start, rules.timeZone);
      (booked[email] ??= {})[key] = (booked[email][key] ?? 0) + 1;
    }
  }

  const visible: Interviewer[] = members
    .filter((c) => !busyByEmail.get(c.email)?.error)
    .map((c) => ({
      email: c.email,
      busy: (busyByEmail.get(c.email)?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
    }));
  return { slots: findSlots(visible, rules, now, booked), busyByEmail, upcoming };
}

export async function rampAvailability(ramp: Ramp, now = new Date()): Promise<RampAvailability> {
  const rules = rulesForRamp(ramp);
  const active = await listActiveWorkforceManagers();
  const byId = new Map<string, TeamMember>(active.map((m) => [m.id, m]));
  const chosen = ramp.interviewerIds.map((id) => byId.get(id)).filter((m): m is TeamMember => Boolean(m));
  const inactive = ramp.interviewerIds.filter((id) => !byId.has(id)).length;
  const today = dayKey(now, rules.timeZone);
  const lastDay = lastWindowDay(rules, now);
  const { slots, busyByEmail } = await computeSlots(rules, chosen, now);
  const days = summarizeByDay(slots, rules.timeZone);
  const nameOf = new Map(chosen.map((c) => [c.email, c.name || c.email]));

  return {
    testMode: testMode(),
    timeZone: rules.timeZone,
    hours: `${rules.startHour}:00–${rules.endHour}:00`,
    window: { from: rules.firstDay && rules.firstDay > today ? rules.firstDay : today, to: lastDay },
    interviewers: [
      ...chosen.map((c) => {
        const problem = busyByEmail.get(c.email)?.error ?? null;
        return { id: c.id, name: c.name, email: c.email, canSee: !problem, problem };
      }),
      ...(inactive
        ? [{ id: "", name: `${inactive} interviewer(s) no longer Active`, email: "", canSee: false, problem: "Not an Active Workforce Manager in Internal Team" }]
        : []),
    ],
    days: days.map((dsum) => ({
      day: dsum.day,
      times: dsum.times,
      first: dsum.first.toISOString(),
      last: dsum.last.toISOString(),
      perInterviewer: Object.fromEntries(Object.entries(dsum.perInterviewer).map(([e, n]) => [nameOf.get(e) ?? e, n])),
    })),
  };
}
