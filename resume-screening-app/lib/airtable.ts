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

async function airtableFetch(path: string): Promise<Response> {
  const res = await fetch(`${API}/${env("AIRTABLE_BASE_ID")}/${path}`, {
    headers: { Authorization: `Bearer ${env("AIRTABLE_TOKEN")}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
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
