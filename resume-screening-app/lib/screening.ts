// The screening page's server side: score candidates for a ramp, send pre-interviews, read the
// pipeline (journeys + pre-interview answers + checks), and record decisions.
import {
  createJourney,
  getPoolCandidates,
  getRamp,
  getRampEmailSettings,
  jobAttachment,
  listJourneys,
  listResults,
  saveResults,
  submissionsByEmail,
  updateJourney,
  updateSubmission,
  type Journey,
  type PoolCandidate,
  type Ramp,
  type Submission,
} from "./airtable";
import { scoreCandidates } from "./claude";
import { sendEmail } from "./google";
import { eligibility, fillTemplate, formatDeadline, preInterviewLink, templateHtml, type Check } from "./pipeline";
import { codeHash, randomToken } from "./session";

export const DEFAULT_FORM_URL = "https://airtable.com/appqmAg1Av6yheTUu/pagaIMemMI8RRpHT1/form";
const LINK_DAYS = 14;

function formUrl(): string {
  return process.env.PRE_INTERVIEW_FORM_URL || DEFAULT_FORM_URL;
}

export class UserError extends Error {}

export async function loadRamp(rampId: string): Promise<Ramp> {
  if (!/^rec[A-Za-z0-9]{14}$/.test(rampId)) throw new UserError("Pick a ramp first.");
  return getRamp(rampId);
}

// ---- Scoring ----

export async function scoreForRamp(ramp: Ramp, jobSummary: string, candidateIds: string[], scoredBy: string) {
  if (!jobSummary) throw new UserError("The job summary is missing. Reload the page.");
  const existing = new Set((await listResults(ramp)).map((r) => r.workerId));
  const candidates = (await getPoolCandidates(candidateIds)).filter((c) => !existing.has(c.workerId));
  if (!candidates.length) return { scored: 0 };
  const scores = await scoreCandidates(jobSummary, candidates);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const rows = scores
    .map((s) => ({ candidate: byId.get(s.id)!, ...s }))
    .filter((r) => r.candidate);
  await saveResults(ramp, rows, scoredBy, process.env.CLAUDE_MODEL || "claude-opus-5");
  return { scored: rows.length };
}

// ---- Pre-interview ----

type Email = { subject: string; text: string; html: string };

function preInterviewEmail(ramp: Ramp, settings: { preSubject: string; preBody: string }, c: PoolCandidate): Email {
  const vars = {
    "First Name": c.firstName || "there",
    "Job Title": ramp.jobTitle,
    "Application Deadline": formatDeadline(ramp.applicationDeadline),
  };
  const link = preInterviewLink(formUrl(), c.email);
  return {
    subject: fillTemplate(settings.preSubject || "Invitation to apply: {Job Title}", vars),
    text: fillTemplate(settings.preBody, { ...vars, "Apply Link": link }),
    html: templateHtml(settings.preBody, vars, { "Apply Link": { url: link, label: "Apply here" } }),
  };
}

function readiness(ramp: Ramp, settings: { preBody: string }): string[] {
  const problems: string[] = [];
  if (!ramp.applicationDeadline) problems.push("Set the ramp's Application Deadline first.");
  if (!ramp.jobTitle) problems.push("Set the ramp's Job Title first.");
  if (!settings.preBody.trim()) problems.push("The ramp has no Pre-interview Email text yet.");
  if (ramp.status === "Closed") problems.push("This ramp is Closed.");
  return problems;
}

export async function sendPreInterviews(ramp: Ramp, candidateIds: string[], dryRun: boolean, sentBy: string) {
  const settings = await getRampEmailSettings(ramp.id);
  const problems = readiness(ramp, settings);
  const already = new Set((await listJourneys(ramp)).map((j) => j.workerId));
  const candidates = (await getPoolCandidates(candidateIds)).filter((c) => !already.has(c.workerId));
  const noEmail = candidates.filter((c) => !c.email.includes("@"));
  const ready = candidates.filter((c) => c.email.includes("@"));
  const preview = ready[0] ? { to: ready[0].email, ...preInterviewEmail(ramp, settings, ready[0]) } : null;
  if (dryRun || problems.length) {
    return { problems, preview, willSend: ready.length, skipped: candidateIds.length - ready.length, sent: 0 };
  }
  const attachment = ramp.jobId ? await jobAttachment(ramp.jobId).catch(() => null) : null;
  let sent = 0;
  const failed: string[] = [];
  for (const c of ready) {
    try {
      const email = preInterviewEmail(ramp, settings, c);
      await sendEmail({ to: c.email, ...email, attachments: attachment ? [attachment] : [] });
      await createJourney({ ramp, candidate: c, createdBy: sentBy });
      sent += 1;
    } catch (error) {
      console.error(error);
      failed.push(c.name);
    }
  }
  return { problems: failed.length ? [`Couldn't send to: ${failed.join(", ")}`] : [], preview: null, willSend: 0, skipped: noEmail.length, sent };
}

// ---- Pipeline ----

export type PipelineRow = {
  journey: Journey;
  submission: Omit<Submission, "candidateIds" | "interviewIds"> | null;
  checks: Check[];
  submissions: number;
  ipCountry: string;
  score: { score: number; verdict: string; summary: string } | null;
};

// Journeys for the ramp, with their pre-interview answers. Links new submissions to the right
// journey (by the email the pre-interview was sent to) and moves it to "Pre-interview received".
export async function pipeline(ramp: Ramp): Promise<{ rows: PipelineRow[]; unmatched: number }> {
  const [journeys, settings, results] = await Promise.all([listJourneys(ramp), getRampEmailSettings(ramp.id), listResults(ramp)]);
  const submissions = await submissionsByEmail(journeys.map((j) => j.candidateEmail));
  const byEmail = new Map<string, Submission[]>();
  for (const s of submissions) byEmail.set(s.email, [...(byEmail.get(s.email) ?? []), s]);
  const candidates = await getPoolCandidates(journeys.map((j) => j.candidateId ?? "").filter(Boolean));
  const ipByCandidate = new Map(candidates.map((c) => [c.id, c.country]));
  const scoreByWorker = new Map(results.map((r) => [r.workerId, r]));

  const rows: PipelineRow[] = [];
  for (const j of journeys) {
    const subs = byEmail.get(j.candidateEmail) ?? [];
    // The latest submission made after the pre-interview was sent.
    const sentAt = Date.parse(j.preInterviewSentAt) || 0;
    const latest = [...subs].reverse().find((s) => (Date.parse(s.created) || 0) >= sentAt - 60_000) ?? null;
    if (latest && !latest.interviewIds.includes(j.id)) {
      await updateSubmission(latest.id, {
        Interview: [j.id],
        ...(j.candidateId ? { Candidate: [j.candidateId] } : {}),
        ...(latest.status ? {} : { "Candidate Status": "Received" }),
      });
    }
    if (latest && j.status === "Pre-interview sent") {
      await updateJourney(j.id, { Status: "Pre-interview received" });
      j.status = "Pre-interview received";
    }
    const ipCountry = (j.candidateId && ipByCandidate.get(j.candidateId)) || "";
    const score = scoreByWorker.get(j.workerId);
    rows.push({
      journey: j,
      submission: latest
        ? (({ candidateIds: _c, interviewIds: _i, ...rest }) => rest)(latest)
        : null,
      checks: latest ? eligibility(latest, settings, ipCountry, subs.length) : [],
      submissions: subs.length,
      ipCountry,
      score: score ? { score: score.score, verdict: score.verdict, summary: score.summary } : null,
    });
  }
  return { rows, unmatched: 0 };
}

// ---- Decisions ----

export async function decide(ramp: Ramp, interviewId: string, decision: "invite" | "not_selected", by: string, origin: string) {
  const journeys = await listJourneys(ramp);
  const j = journeys.find((x) => x.id === interviewId);
  if (!j) throw new UserError("That candidate isn't in this ramp.");
  const subs = await submissionsByEmail([j.candidateEmail]);
  const linked = subs.filter((s) => s.interviewIds.includes(j.id));

  if (decision === "not_selected") {
    await updateJourney(j.id, { Status: "Not selected" });
    for (const s of linked) await updateSubmission(s.id, { "Candidate Status": "Not selected", ...(by.includes("@") ? { Reviewer: by } : {}) });
    return { status: "Not selected" };
  }

  if (!["Pre-interview received", "Pre-interview sent", "Invite drafted"].includes(j.status)) {
    throw new UserError(`Can't invite: this candidate is already "${j.status}".`);
  }
  if (ramp.status !== "Open") throw new UserError("Set the ramp to Open before inviting candidates to book.");
  if (!ramp.interviewerIds.length) throw new UserError("The ramp has no interviewers yet.");
  const settings = await getRampEmailSettings(ramp.id);
  if (!settings.inviteBody.trim()) throw new UserError("The ramp has no Interview Invite Email text yet.");

  const code = randomToken();
  const expires = new Date(Date.now() + LINK_DAYS * 86_400_000);
  const bookingLink = `${origin}/book/${code}`;
  const vars = {
    "First Name": j.candidateName.split(/\s+/)[0] || "there",
    "Job Title": ramp.jobTitle,
    "Link Expires": new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(expires),
  };
  // Save the code's fingerprint first, so the link works the moment the email lands.
  await updateJourney(j.id, {
    "Booking Code Check": await codeHash(code),
    "Link Expires": expires.toISOString(),
    Status: "Invite sent",
  });
  try {
    await sendEmail({
      to: j.candidateEmail,
      subject: fillTemplate(settings.inviteSubject || "Book your interview: {Job Title}", vars),
      text: fillTemplate(settings.inviteBody, { ...vars, "Booking Link": bookingLink }),
      html: templateHtml(settings.inviteBody, vars, { "Booking Link": { url: bookingLink, label: "Pick a time" } }),
    });
  } catch (error) {
    // The email didn't go out: put the row back so the button can be tried again.
    await updateJourney(j.id, { Status: j.status, "Booking Code Check": null, "Link Expires": null });
    throw error;
  }
  const now = new Date().toISOString();
  await updateJourney(j.id, {
    "Invite Sent At": now,
    "Last Email Sent": "Interview invite",
    "Last Email Sent At": now,
    ...(by.includes("@") ? { "Approved By": by } : {}),
  });
  for (const s of linked) await updateSubmission(s.id, { "Candidate Status": "Selected for interview", ...(by.includes("@") ? { Reviewer: by } : {}) });
  return { status: "Invite sent" };
}
