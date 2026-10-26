// The candidate side of scheduling: what a private booking link shows, and booking a time.
// Candidates never sign in; their link's secret code is the only key, and only its fingerprint
// is stored (Interviews > Booking Code Check).
import {
  findInterviewByCode,
  getInterview,
  getJob,
  getRamp,
  listActiveWorkforceManagers,
  markInterviewScheduled,
  type Interview,
  type Ramp,
  type TeamMember,
} from "./airtable";
import { createInterviewEvent, freeBusy } from "./google";
import { computeSlots, rulesForRamp } from "./ramps";
import { isValidTimeZone, pickInterviewer, stillFree } from "./scheduling";
import { codeHash } from "./session";

export type BookingView =
  | { state: "invalid" | "expired" | "closed" }
  | { state: "booked"; firstName: string; role: string; start: string; end: string; meetLink: string }
  | { state: "open"; firstName: string; role: string; minutes: number; slots: { start: string; end: string }[] };

type Context = { interview: Interview; ramp: Ramp | null; role: string; interviewers: TeamMember[] };

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

// Finds the interview for a code and works out whether it can be booked, and with whom.
async function load(code: string): Promise<{ view: BookingView } | { context: Context }> {
  const interview = await findInterviewByCode(await codeHash(code));
  if (!interview) return { view: { state: "invalid" } };
  const ramp = interview.rampId ? await getRamp(interview.rampId) : null;
  // The ramp's Job Title is what candidates should see; job names in Airtable start with "JD …".
  const role = ramp?.jobTitle || (interview.jobId ? (await getJob(interview.jobId)).name : "");
  if (interview.status === "Scheduled") {
    return {
      view: {
        state: "booked",
        firstName: firstName(interview.candidateName),
        role,
        start: interview.start,
        end: interview.end,
        meetLink: interview.meetLink,
      },
    };
  }
  if (interview.status === "Link expired" || (interview.linkExpires && Date.parse(interview.linkExpires) < Date.now())) {
    return { view: { state: "expired" } };
  }
  if (interview.status !== "Invite sent" || ramp?.status === "Closed") return { view: { state: "closed" } };

  // Who can interview: the invite's own list, else the ramp's, else every Active Workforce Manager.
  const active = await listActiveWorkforceManagers();
  const wanted = interview.offeredIds.length ? interview.offeredIds : (ramp?.interviewerIds ?? []);
  const interviewers = wanted.length ? active.filter((m) => wanted.includes(m.id)) : active;
  return { context: { interview, ramp, role, interviewers } };
}

export async function bookingView(code: string, now = new Date()): Promise<BookingView> {
  const loaded = await load(code);
  if ("view" in loaded) return loaded.view;
  const { interview, ramp, role, interviewers } = loaded.context;
  const rules = rulesForRamp(ramp);
  const { slots } = await computeSlots(rules, interviewers, now);
  return {
    state: "open",
    firstName: firstName(interview.candidateName),
    role,
    minutes: rules.minutes,
    // Candidates only see times, never who is free.
    slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
  };
}

export class BookingError extends Error {}

// Books the chosen time: re-checks it's still open, picks the least-busy free interviewer,
// creates the calendar event with a Meet link, and marks the interview Scheduled.
export async function bookTime(code: string, startIso: string, timeZone: string, now = new Date()) {
  const loaded = await load(code);
  if ("view" in loaded) {
    if (loaded.view.state === "booked") throw new BookingError("This interview is already booked.");
    throw new BookingError("This booking link is no longer active.");
  }
  const { interview, ramp, role, interviewers } = loaded.context;
  const rules = rulesForRamp(ramp);
  const { slots, upcoming } = await computeSlots(rules, interviewers, now);
  const slot = slots.find((s) => s.start.toISOString() === new Date(startIso).toISOString());
  if (!slot) throw new BookingError("Sorry, that time was just taken. Please pick another.");

  // Fair sharing: the free interviewer with the fewest upcoming interviews.
  const emailToId = new Map(interviewers.map((m) => [m.email, m.id]));
  const counts: Record<string, number> = {};
  const lastBooked: Record<string, number> = {};
  for (const iv of upcoming) {
    for (const id of iv.interviewerIds) {
      const email = interviewers.find((m) => m.id === id)?.email;
      if (!email) continue;
      counts[email] = (counts[email] ?? 0) + 1;
      lastBooked[email] = Math.max(lastBooked[email] ?? 0, iv.bookedAt);
    }
  }
  const candidates = [...slot.free];
  let chosen: string | null = null;
  // Last-second check, in case a meeting landed on their calendar since the page loaded.
  while (candidates.length && !chosen) {
    const pick = pickInterviewer(candidates, counts, lastBooked);
    if (!pick) break;
    const [fresh] = await freeBusy([pick], new Date(slot.start.getTime() - 3_600_000).toISOString(), new Date(slot.end.getTime() + 3_600_000).toISOString());
    const busy = (fresh?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    if (!fresh?.error && stillFree(busy, slot, rules.bufferMinutes)) chosen = pick;
    else candidates.splice(candidates.indexOf(pick), 1);
  }
  if (!chosen) throw new BookingError("Sorry, that time was just taken. Please pick another.");

  // Re-read the interview right before booking, so a double click can't book twice.
  if ((await getInterview(interview.id)).status !== "Invite sent") throw new BookingError("This interview is already booked.");

  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const title = role ? `Scale interview: ${role}` : "Scale interview";
  const event = await createInterviewEvent({
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
    summary: `${title} (${interview.candidateName})`,
    description: [
      `${rules.minutes}-minute video interview with Scale.`,
      "Join with the Google Meet link in this invitation.",
      "Need to change the time? Reply to the email you received from us.",
    ].join("\n"),
    attendees: [chosen, interview.candidateEmail],
    requestId: `${interview.id}-${slot.start.getTime()}`,
  });
  await markInterviewScheduled(interview.id, {
    interviewerId: emailToId.get(chosen)!,
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
    timeZone: zone,
    meetLink: event.meetLink,
    eventId: event.eventId,
  });
  return { start: slot.start.toISOString(), end: slot.end.toISOString(), meetLink: event.meetLink, role };
}
