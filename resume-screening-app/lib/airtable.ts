// Reads jobs and candidates from the Airtable base using the Airtable REST API.

const API = "https://api.airtable.com/v0";

export const JOBS_TABLE = "Job Description Links";

// People allowed to sign in: Internal Team rows with Status = Active.
const TEAM_TABLE = "tblncVYLpY2aTSli1";

// Candidate pools: one Airtable table per pool. BDR and WPC share the same profile columns.
// Select CBs only have tier info and a resume, so they are scored from the resume PDF.
export const POOLS = ["BDR", "WPC", "Select CBs"] as const;
export type Pool = (typeof POOLS)[number];

const POOL_TABLES: Record<Pool, string> = { BDR: "BDR", WPC: "WPC", "Select CBs": "tblbT2o0Il8cjaKaJ" };

export function isPool(value: unknown): value is Pool {
  return typeof value === "string" && (POOLS as readonly string[]).includes(value);
}

type Attachment = { url: string; filename: string; type: string };
type AirtableRecord = { id: string; fields: Record<string, unknown> };

export type Job = { id: string; name: string; fileUrl: string | null };

export type Candidate = {
  id: string;
  name: string;
  email: string;
  country: string;
  jobTitle: string;
  company: string;
  experience: string;
  education: string;
  skills: string;
  projects: string;
  resumeUrl: string | null;
  subtitle: string;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

async function airtableFetch(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const res = await fetch(`${API}/${env("AIRTABLE_BASE_ID")}/${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${env("AIRTABLE_TOKEN")}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 403 && init.method && init.method !== "GET") {
      throw new Error("Airtable refused to save: the AIRTABLE_TOKEN can only read. Add a token with data.records:write.");
    }
    throw new Error(`Airtable error ${res.status}: ${detail}`);
  }
  return res;
}

async function listAll(table: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const res = await airtableFetch(`${encodeURIComponent(table)}?${params}`);
    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

async function getRecord(table: string, id: string): Promise<AirtableRecord> {
  const res = await airtableFetch(`${encodeURIComponent(table)}/${encodeURIComponent(id)}`);
  return (await res.json()) as AirtableRecord;
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object" && "name" in value) return String(value.name);
  return String(value);
}

function firstAttachmentUrl(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (value[0] as Attachment).url ?? null;
}

function toJob(record: AirtableRecord): Job {
  const f = record.fields;
  return {
    id: record.id,
    name: text(f["Job Description Upload"]) || "Untitled job",
    fileUrl: firstAttachmentUrl(f["JD Attachment"]),
  };
}

function toCandidate(record: AirtableRecord): Candidate {
  const f = record.fields;
  const name = text(f.NAME) || [text(f.FIRST_NAME), text(f.LAST_NAME)].filter(Boolean).join(" ");
  return {
    id: record.id,
    name: name || text(f.EMAIL) || record.id,
    email: text(f.EMAIL) || text(f.WORKER_EMAIL),
    country: text(f.IP_COUNTRY_CODE),
    jobTitle: text(f.JOB_TITLE),
    company: text(f.JOB_COMPANY),
    experience: text(f.JOB_EXPERIENCE),
    education: text(f.EDUCATION),
    skills: text(f.WORKERSKILLS),
    projects: text(f.PROJECTS),
    resumeUrl:
      firstAttachmentUrl(f["Resume from Outlier Attachment"]) ||
      text(f["Resume from Outlier URL"]) ||
      null,
    subtitle: [text(f.TIER_LEVEL), text(f.TEAM_FROZEN)].filter(Boolean).join(" · "),
  };
}

export async function listJobs(): Promise<Job[]> {
  return (await listAll(JOBS_TABLE)).map(toJob);
}

export async function getJob(id: string): Promise<Job> {
  return toJob(await getRecord(JOBS_TABLE, id));
}

export async function listCandidates(pool: Pool): Promise<Candidate[]> {
  return (await listAll(POOL_TABLES[pool])).map(toCandidate);
}

export async function getCandidate(pool: Pool, id: string): Promise<Candidate> {
  return toCandidate(await getRecord(POOL_TABLES[pool], id));
}

export type TeamMember = { id: string; email: string; name: string; role: string };

// Finds an Active Internal Team member by email (case-insensitive), or null.
export async function findActiveTeamMember(email: string): Promise<TeamMember | null> {
  const clean = email.trim().toLowerCase();
  // Emails with quotes or backslashes can't be real sign-in addresses; refusing them keeps the formula safe.
  if (!/^[^\s@'"\\]+@[^\s@'"\\]+$/.test(clean)) return null;
  const formula = `AND(LOWER(TRIM({Email}))='${clean}', {Status}='Active')`;
  const params = new URLSearchParams({ filterByFormula: formula, maxRecords: "1" });
  const res = await airtableFetch(`${TEAM_TABLE}?${params}`);
  const { records } = (await res.json()) as { records: AirtableRecord[] };
  const record = records[0];
  if (!record) return null;
  const f = record.fields;
  return { id: record.id, email: clean, name: text(f["First and Last Name"]), role: text(f.Roll) };
}

// Interviewers: Internal Team rows with Roll = Workforce Manager and Status = Active.
export async function listActiveWorkforceManagers(): Promise<TeamMember[]> {
  const params = new URLSearchParams({
    filterByFormula: "AND({Roll}='Workforce Manager', {Status}='Active')",
    pageSize: "100",
  });
  const res = await airtableFetch(`${TEAM_TABLE}?${params}`);
  const { records } = (await res.json()) as { records: AirtableRecord[] };
  return records
    .map((r) => ({
      id: r.id,
      email: text(r.fields.Email).toLowerCase(),
      name: text(r.fields["First and Last Name"]),
      role: text(r.fields.Roll),
    }))
    .filter((m) => m.email.includes("@"));
}

export const INTERVIEWS_TABLE = "tblzBwlRtIvzXWpws";

export type UpcomingInterview = { interviewerIds: string[]; start: Date; bookedAt: number };

// Scheduled interviews still ahead: used for fair sharing and for ramps' daily limits.
export async function upcomingInterviews(): Promise<UpcomingInterview[]> {
  const out: UpcomingInterview[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({
      filterByFormula: "AND({Status}='Scheduled', IS_AFTER({Start}, NOW()))",
      pageSize: "100",
    });
    for (const f of ["Interviewer", "Start", "Booked At"]) params.append("fields[]", f);
    if (offset) params.set("offset", offset);
    const res = await airtableFetch(`${INTERVIEWS_TABLE}?${params}`);
    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    for (const r of data.records) {
      out.push({
        interviewerIds: (r.fields.Interviewer as string[] | undefined) ?? [],
        start: new Date(text(r.fields.Start)),
        bookedAt: Date.parse(text(r.fields["Booked At"])) || 0,
      });
    }
    offset = data.offset;
  } while (offset);
  return out;
}

// ---- Interviews ----

export type InterviewStatus =
  | "Pre-interview sent"
  | "Pre-interview received"
  | "Not selected"
  | "Invite drafted"
  | "Invite sent"
  | "Scheduled"
  | "Completed"
  | "No-show"
  | "Cancelled"
  | "Link expired";

export type Interview = {
  id: string;
  status: InterviewStatus;
  candidateName: string;
  candidateEmail: string;
  workerId: string;
  candidateId: string | null;
  jobId: string | null;
  rampId: string | null;
  offeredIds: string[];
  interviewerId: string | null;
  start: string;
  end: string;
  meetLink: string;
  eventId: string;
  linkExpires: string;
};

function toInterview(record: AirtableRecord): Interview {
  const f = record.fields;
  const first = (v: unknown) => ((v as string[] | undefined) ?? [])[0] ?? null;
  return {
    id: record.id,
    status: (text(f.Status) || "Invite drafted") as InterviewStatus,
    candidateName: text(f["Candidate Name"]),
    candidateEmail: text(f["Candidate Email"]).toLowerCase(),
    workerId: text(f["Worker ID"]),
    candidateId: first(f.Candidate),
    jobId: first(f.Job),
    rampId: first(f.Ramp),
    offeredIds: (f["Interviewers Offered"] as string[] | undefined) ?? [],
    interviewerId: first(f.Interviewer),
    start: text(f.Start),
    end: text(f.End),
    meetLink: text(f["Meet Link"]),
    eventId: text(f["Calendar Event ID"]),
    linkExpires: text(f["Link Expires"]),
  };
}

// The interview whose private booking link has this fingerprint, or null.
export async function findInterviewByCode(codeHash: string): Promise<Interview | null> {
  if (!/^[0-9a-f]{64}$/.test(codeHash)) return null;
  const params = new URLSearchParams({ filterByFormula: `{Booking Code Check}='${codeHash}'`, maxRecords: "2" });
  const res = await airtableFetch(`${INTERVIEWS_TABLE}?${params}`);
  const { records } = (await res.json()) as { records: AirtableRecord[] };
  return records.length === 1 ? toInterview(records[0]) : null;
}

export async function getInterview(id: string): Promise<Interview> {
  return toInterview(await getRecord(INTERVIEWS_TABLE, id));
}

export async function markInterviewScheduled(
  id: string,
  booking: { interviewerId: string; start: string; end: string; timeZone: string; meetLink: string; eventId: string },
): Promise<void> {
  await airtableFetch(`${INTERVIEWS_TABLE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: {
      fields: {
        Status: "Scheduled",
        Interviewer: [booking.interviewerId],
        Start: booking.start,
        End: booking.end,
        "Candidate Time Zone": booking.timeZone,
        "Meet Link": booking.meetLink,
        "Calendar Event ID": booking.eventId,
        "Booked At": new Date().toISOString(),
      },
    },
  });
}

// ---- Ramps ----

export const RAMPS_TABLE = "tblZlesc5Tg4OvVJJ";
export const RAMP_STATUSES = ["Planning", "Open", "Closed"] as const;
export type RampStatus = (typeof RAMP_STATUSES)[number];

export type Ramp = {
  id: string;
  name: string;
  jobId: string | null;
  interviewerIds: string[];
  status: RampStatus;
  startDate: string;
  endDate: string;
  hoursStart: number | null;
  hoursEnd: number | null;
  timeZone: string;
  maxPerDay: number | null;
  createdBy: string;
  notes: string;
  jobTitle: string;
  applicationDeadline: string;
};

// Settings edited in Airtable for now (email templates, eligibility rules).
export type RampEmailSettings = {
  preSubject: string;
  preBody: string;
  inviteSubject: string;
  inviteBody: string;
  minWeeklyHours: number | null;
  weekendsRequired: boolean;
  eightHourRequired: boolean;
  minEnglish: string;
};

export type RampInput = Omit<Ramp, "id" | "createdBy">;

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toRamp(record: AirtableRecord): Ramp {
  const f = record.fields;
  const status = text(f.Status) as RampStatus;
  return {
    id: record.id,
    name: text(f["Ramp Name"]) || "Untitled ramp",
    jobId: ((f.Job as string[] | undefined) ?? [])[0] ?? null,
    interviewerIds: (f.Interviewers as string[] | undefined) ?? [],
    status: RAMP_STATUSES.includes(status) ? status : "Planning",
    startDate: text(f["Start Date"]),
    endDate: text(f["End Date"]),
    hoursStart: num(f["Booking Hours Start"]),
    hoursEnd: num(f["Booking Hours End"]),
    timeZone: text(f["Time Zone"]),
    maxPerDay: num(f["Max Per Interviewer Per Day"]),
    createdBy: text(f["Created By"]),
    notes: text(f.Notes),
    jobTitle: text(f["Job Title"]),
    applicationDeadline: text(f["Application Deadline"]),
  };
}

export async function getRampEmailSettings(id: string): Promise<RampEmailSettings> {
  const f = (await getRecord(RAMPS_TABLE, id)).fields;
  return {
    preSubject: text(f["Pre-interview Email Subject"]),
    preBody: typeof f["Pre-interview Email"] === "string" ? (f["Pre-interview Email"] as string) : "",
    inviteSubject: text(f["Interview Invite Subject"]),
    inviteBody: typeof f["Interview Invite Email"] === "string" ? (f["Interview Invite Email"] as string) : "",
    minWeeklyHours: num(f["Min Weekly Hours"]),
    weekendsRequired: f["Weekends Required"] === true,
    eightHourRequired: f["8-Hour Shifts Required"] === true,
    minEnglish: text(f["Min English Level"]),
  };
}

function rampFields(input: Partial<RampInput>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (input.name !== undefined) fields["Ramp Name"] = input.name;
  if (input.jobId !== undefined) fields.Job = input.jobId ? [input.jobId] : [];
  if (input.interviewerIds !== undefined) fields.Interviewers = input.interviewerIds;
  if (input.status !== undefined) fields.Status = input.status;
  if (input.startDate !== undefined) fields["Start Date"] = input.startDate || null;
  if (input.endDate !== undefined) fields["End Date"] = input.endDate || null;
  if (input.hoursStart !== undefined) fields["Booking Hours Start"] = input.hoursStart;
  if (input.hoursEnd !== undefined) fields["Booking Hours End"] = input.hoursEnd;
  if (input.timeZone !== undefined) fields["Time Zone"] = input.timeZone;
  if (input.maxPerDay !== undefined) fields["Max Per Interviewer Per Day"] = input.maxPerDay;
  if (input.notes !== undefined) fields.Notes = input.notes;
  if (input.jobTitle !== undefined) fields["Job Title"] = input.jobTitle;
  if (input.applicationDeadline !== undefined) fields["Application Deadline"] = input.applicationDeadline || null;
  return fields;
}

export async function listRamps(): Promise<Ramp[]> {
  return (await listAll(RAMPS_TABLE)).map(toRamp);
}

export async function getRamp(id: string): Promise<Ramp> {
  return toRamp(await getRecord(RAMPS_TABLE, id));
}

export async function createRamp(input: RampInput, createdBy: string): Promise<Ramp> {
  const res = await airtableFetch(RAMPS_TABLE, {
    method: "POST",
    body: { fields: { ...rampFields(input), "Created By": createdBy } },
  });
  return toRamp((await res.json()) as AirtableRecord);
}

export async function updateRamp(id: string, input: Partial<RampInput>): Promise<Ramp> {
  const res = await airtableFetch(`${RAMPS_TABLE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { fields: rampFields(input) },
  });
  return toRamp((await res.json()) as AirtableRecord);
}

// Downloads a PDF (job description or resume) and returns it base64-encoded for Claude.
// Airtable attachment links expire after a few hours, so always fetch a fresh record first.
export async function downloadPdfBase64(url: string): Promise<string | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await res.arrayBuffer());
  const looksLikePdf = type.includes("pdf") || bytes.subarray(0, 4).toString() === "%PDF";
  return looksLikePdf ? bytes.toString("base64") : null;
}

// Only fetch files hosted by Airtable (candidate lists send resume links back from the browser).
export function isAirtableFile(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "dl.airtable.com" || hostname.endsWith(".airtableusercontent.com"));
  } catch {
    return false;
  }
}

// True when a candidate has profile text to score from (BDR/WPC); Select CBs only have a resume.
export function hasProfileText(c: Candidate): boolean {
  return Boolean(c.jobTitle || c.company || c.experience || c.education || c.skills || c.projects);
}

// ---- Candidate Pool (the screener's source) ----

export const POOL_TABLE = "tblLe5hlGq09KlQCu";
const POOL_FIELDS = [
  "WORKER_ID", "FIRST_NAME", "LAST_NAME", "EMAIL", "IP_COUNTRY_CODE", "WORKER_TEAM_NAME", "WORKER_SOURCE",
  "JOB_TITLE", "JOB_COMPANY", "JOB_EXPERIENCE", "EDUCATION", "HIGHEST_DEGREE", "WORKERSKILLS", "PROJECTS",
  "LAST_ACTIVE", "QMS_SCORE", "QC_SCORE", "Resume Status",
];

export type PoolCandidate = Candidate & {
  workerId: string;
  firstName: string;
  team: string;
  lastActive: string;
  qms: number | null;
  qc: number | null;
  hasResume: boolean;
};

function toPoolCandidate(record: AirtableRecord): PoolCandidate {
  const f = record.fields;
  const resumeStatus = text(f["Resume Status"]);
  return {
    id: record.id,
    workerId: text(f.WORKER_ID),
    firstName: text(f.FIRST_NAME),
    name: [text(f.FIRST_NAME), text(f.LAST_NAME)].filter(Boolean).join(" ") || text(f.WORKER_ID),
    email: text(f.EMAIL).toLowerCase(),
    country: text(f.IP_COUNTRY_CODE),
    team: text(f.WORKER_TEAM_NAME),
    jobTitle: text(f.JOB_TITLE),
    company: text(f.JOB_COMPANY),
    experience: text(f.JOB_EXPERIENCE),
    education: [text(f.EDUCATION), text(f.HIGHEST_DEGREE)].filter(Boolean).join(" · "),
    skills: text(f.WORKERSKILLS),
    projects: text(f.PROJECTS).slice(0, 4000),
    resumeUrl: null,
    subtitle: text(f.WORKER_TEAM_NAME),
    lastActive: text(f.LAST_ACTIVE),
    qms: num(f.QMS_SCORE),
    qc: num(f.QC_SCORE),
    hasResume: resumeStatus === "ok" || resumeStatus === "resolved",
  };
}

export type PoolFilters = { countries: string[]; activeDays: number | null; hasResume: boolean; minQms: number | null; minQc: number | null };

function quote(value: string): string {
  return `'${value.replace(/['\\]/g, "")}'`;
}

// Candidates matching the filters, up to `limit` (plus whether there were more).
export async function searchPool(filters: PoolFilters, limit: number): Promise<{ candidates: PoolCandidate[]; more: boolean }> {
  const parts: string[] = [];
  const countries = filters.countries.filter((c) => /^[A-Z]{2}$/.test(c));
  if (countries.length) parts.push(`OR(${countries.map((c) => `{IP_COUNTRY_CODE}=${quote(c)}`).join(",")})`);
  if (filters.activeDays) parts.push(`IS_AFTER({LAST_ACTIVE}, DATEADD(NOW(), -${Math.floor(filters.activeDays)}, 'days'))`);
  if (filters.hasResume) parts.push(`OR({Resume Status}='ok', {Resume Status}='resolved')`);
  if (filters.minQms != null) parts.push(`{QMS_SCORE}>=${Number(filters.minQms)}`);
  if (filters.minQc != null) parts.push(`{QC_SCORE}>=${Number(filters.minQc)}`);
  const formula = parts.length ? `AND(${parts.join(",")})` : "TRUE()";
  const out: PoolCandidate[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
    for (const f of POOL_FIELDS) params.append("fields[]", f);
    params.append("sort[0][field]", "LAST_ACTIVE");
    params.append("sort[0][direction]", "desc");
    if (offset) params.set("offset", offset);
    const res = await airtableFetch(`${POOL_TABLE}?${params}`);
    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    out.push(...data.records.map(toPoolCandidate));
    offset = data.offset;
  } while (offset && out.length <= limit);
  return { candidates: out.slice(0, limit), more: out.length > limit || Boolean(offset) };
}

// Fresh candidate records by Airtable id (at most 50 at a time).
export async function getPoolCandidates(ids: string[]): Promise<PoolCandidate[]> {
  const clean = ids.filter((id) => /^rec[A-Za-z0-9]{14}$/.test(id)).slice(0, 50);
  if (!clean.length) return [];
  const params = new URLSearchParams({ filterByFormula: `OR(${clean.map((id) => `RECORD_ID()='${id}'`).join(",")})`, pageSize: "100" });
  for (const f of POOL_FIELDS) params.append("fields[]", f);
  const res = await airtableFetch(`${POOL_TABLE}?${params}`);
  return ((await res.json()) as { records: AirtableRecord[] }).records.map(toPoolCandidate);
}

// Rows linked to a ramp, found by the ramp's name in the link field.
async function listLinkedToRamp(table: string, rampName: string, fields: string[]): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ filterByFormula: `FIND(${quote(rampName)}, ARRAYJOIN({Ramp}, '|'))`, pageSize: "100" });
    for (const f of fields) params.append("fields[]", f);
    if (offset) params.set("offset", offset);
    const res = await airtableFetch(`${table}?${params}`);
    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

// ---- Screening Results ----

export const RESULTS_TABLE = "tblIm6ybRQTlmqHWN";

export type ScreeningResult = {
  id: string;
  workerId: string;
  score: number;
  verdict: "Strong fit" | "Possible fit" | "Weak fit";
  summary: string;
  strengths: string[];
  gaps: string[];
  scoredAt: string;
};

export async function listResults(ramp: Ramp): Promise<ScreeningResult[]> {
  const records = await listLinkedToRamp(RESULTS_TABLE, ramp.name, ["Ramp", "Worker ID", "Fit Score", "Verdict", "Summary", "Strengths", "Gaps", "Scored At"]);
  const lines = (v: unknown) => text(v).split("\n").map((l) => l.replace(/^[-•]\s*/, "").trim()).filter(Boolean);
  return records
    .filter((r) => ((r.fields.Ramp as string[] | undefined) ?? []).includes(ramp.id))
    .map((r) => ({
      id: r.id,
      workerId: text(r.fields["Worker ID"]),
      score: num(r.fields["Fit Score"]) ?? 0,
      verdict: (text(r.fields.Verdict) || "Weak fit") as ScreeningResult["verdict"],
      summary: text(r.fields.Summary),
      strengths: lines(r.fields.Strengths),
      gaps: lines(r.fields.Gaps),
      scoredAt: text(r.fields["Scored At"]),
    }));
}

export async function saveResults(
  ramp: Ramp,
  rows: { candidate: PoolCandidate; score: number; verdict: string; summary: string; strengths: string[]; gaps: string[] }[],
  scoredBy: string,
  model: string,
): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 10) {
    await airtableFetch(RESULTS_TABLE, {
      method: "POST",
      body: {
        typecast: true,
        records: rows.slice(i, i + 10).map((r) => ({
          fields: {
            Candidate: [r.candidate.id],
            Ramp: [ramp.id],
            "Worker ID": r.candidate.workerId,
            "Fit Score": r.score,
            Verdict: r.verdict,
            Summary: r.summary,
            Strengths: r.strengths.map((s) => `- ${s}`).join("\n"),
            Gaps: r.gaps.map((s) => `- ${s}`).join("\n"),
            "Scored At": now,
            "Scored By": scoredBy.includes("@") ? scoredBy : null,
            Model: model,
          },
        })),
      },
    });
  }
}

// ---- Journeys (Interviews rows) for a ramp ----

export type Journey = Interview & { preInterviewSentAt: string; lastEmailSent: string };

export async function listJourneys(ramp: Ramp): Promise<Journey[]> {
  const records = await listLinkedToRamp(INTERVIEWS_TABLE, ramp.name, [
    "Ramp", "Status", "Candidate", "Candidate Name", "Candidate Email", "Worker ID", "Job", "Interviewers Offered",
    "Interviewer", "Start", "End", "Meet Link", "Calendar Event ID", "Link Expires", "Pre-Interview Sent At", "Last Email Sent",
  ]);
  return records
    .filter((r) => ((r.fields.Ramp as string[] | undefined) ?? []).includes(ramp.id))
    .map((r) => ({ ...toInterview(r), preInterviewSentAt: text(r.fields["Pre-Interview Sent At"]), lastEmailSent: text(r.fields["Last Email Sent"]) }));
}

export async function createJourney(input: {
  ramp: Ramp;
  candidate: PoolCandidate;
  createdBy: string;
}): Promise<string> {
  const now = new Date().toISOString();
  const res = await airtableFetch(INTERVIEWS_TABLE, {
    method: "POST",
    body: {
      fields: {
        Candidate: [input.candidate.id],
        "Worker ID": input.candidate.workerId,
        "Candidate Name": input.candidate.name,
        "Candidate Email": input.candidate.email,
        ...(input.ramp.jobId ? { Job: [input.ramp.jobId] } : {}),
        Ramp: [input.ramp.id],
        Status: "Pre-interview sent",
        "Pre-Interview Sent At": now,
        "Last Email Sent": "Pre-interview",
        "Last Email Sent At": now,
        ...(input.createdBy.includes("@") ? { "Created By": input.createdBy } : {}),
      },
    },
  });
  return ((await res.json()) as AirtableRecord).id;
}

export async function updateJourney(id: string, fields: Record<string, unknown>): Promise<void> {
  await airtableFetch(`${INTERVIEWS_TABLE}/${encodeURIComponent(id)}`, { method: "PATCH", body: { typecast: true, fields } });
}

// ---- Pre-Interview submissions ----

export const PRE_INTERVIEW_TABLE = "tblBtTtfY5CG33ROb";
// Government ID is deliberately never read by the hub; only whether it was given.
const SUBMISSION_FIELDS = [
  "Submission #", "Clean Email", "Full Name", "Country of Residence", "Other Country", "State (US)", "Work Authorization",
  "English Proficiency", "8-Hour Shifts", "Days Available", "Weekly Hours", "Highest Degree", "Earliest Start Date",
  "Ack: Contract Duration", "Referred By", "LinkedIn Profile", "Candidate", "Interview", "Candidate Status", "Created",
  "Has Government ID",
];

export type Submission = {
  id: string;
  number: number;
  email: string;
  fullName: string;
  country: string;
  otherCountry: string;
  state: string;
  workAuthorization: string;
  english: string;
  eightHour: string;
  days: string[];
  weeklyHours: number | null;
  degree: string;
  startDate: string;
  ackContract: boolean;
  referredBy: string;
  linkedin: string;
  candidateIds: string[];
  interviewIds: string[];
  status: string;
  created: string;
  hasGovernmentId: boolean;
};

function toSubmission(r: AirtableRecord): Submission {
  const f = r.fields;
  return {
    id: r.id,
    number: num(f["Submission #"]) ?? 0,
    email: text(f["Clean Email"]),
    fullName: text(f["Full Name"]),
    country: text(f["Country of Residence"]),
    otherCountry: text(f["Other Country"]),
    state: text(f["State (US)"]),
    workAuthorization: text(f["Work Authorization"]),
    english: text(f["English Proficiency"]),
    eightHour: text(f["8-Hour Shifts"]),
    days: ((f["Days Available"] as unknown[] | undefined) ?? []).map(text),
    weeklyHours: num(f["Weekly Hours"]),
    degree: text(f["Highest Degree"]),
    startDate: text(f["Earliest Start Date"]),
    ackContract: f["Ack: Contract Duration"] === true,
    referredBy: text(f["Referred By"]),
    linkedin: text(f["LinkedIn Profile"]),
    candidateIds: (f.Candidate as string[] | undefined) ?? [],
    interviewIds: (f.Interview as string[] | undefined) ?? [],
    status: text(f["Candidate Status"]),
    created: text(f.Created),
    hasGovernmentId: f["Has Government ID"] === 1 || f["Has Government ID"] === true,
  };
}

// All submissions from these email addresses (lowercased), oldest first.
export async function submissionsByEmail(emails: string[]): Promise<Submission[]> {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@'"\\]+@[^\s@'"\\]+$/.test(e)))];
  const out: Submission[] = [];
  for (let i = 0; i < unique.length; i += 40) {
    const batch = unique.slice(i, i + 40);
    const params = new URLSearchParams({ filterByFormula: `OR(${batch.map((e) => `{Clean Email}=${quote(e)}`).join(",")})`, pageSize: "100" });
    for (const f of SUBMISSION_FIELDS) params.append("fields[]", f);
    params.append("sort[0][field]", "Submission #");
    const res = await airtableFetch(`${PRE_INTERVIEW_TABLE}?${params}`);
    out.push(...((await res.json()) as { records: AirtableRecord[] }).records.map(toSubmission));
  }
  return out;
}

export async function updateSubmission(id: string, fields: Record<string, unknown>): Promise<void> {
  await airtableFetch(`${PRE_INTERVIEW_TABLE}/${encodeURIComponent(id)}`, { method: "PATCH", body: { typecast: true, fields } });
}

// The job description PDF for attaching to emails: fresh link, then the bytes.
export async function jobAttachment(jobId: string): Promise<{ filename: string; mimeType: string; base64: string } | null> {
  const f = (await getRecord(JOBS_TABLE, jobId)).fields;
  const file = ((f["JD Attachment"] as Attachment[] | undefined) ?? [])[0];
  if (!file?.url) return null;
  const res = await fetch(file.url, { cache: "no-store" });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 15 * 1024 * 1024) return null;
  return { filename: file.filename || "Job description.pdf", mimeType: file.type || "application/pdf", base64: bytes.toString("base64") };
}
