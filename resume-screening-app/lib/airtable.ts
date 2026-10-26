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
