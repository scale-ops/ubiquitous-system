// Reads jobs and candidates from the Airtable base using the Airtable REST API.

const API = "https://api.airtable.com/v0";

export const JOBS_TABLE = "Job Description Links";

// Candidate pools: one Airtable table per pool. All pools share the same columns.
export const POOLS = ["BDR", "WPC"] as const;
export type Pool = (typeof POOLS)[number];

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
  const name = [text(f.FIRST_NAME), text(f.LAST_NAME)].filter(Boolean).join(" ");
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
  };
}

export async function listJobs(): Promise<Job[]> {
  return (await listAll(JOBS_TABLE)).map(toJob);
}

export async function getJob(id: string): Promise<Job> {
  return toJob(await getRecord(JOBS_TABLE, id));
}

export async function listCandidates(pool: Pool): Promise<Candidate[]> {
  return (await listAll(pool)).map(toCandidate);
}

export async function getCandidate(pool: Pool, id: string): Promise<Candidate> {
  return toCandidate(await getRecord(pool, id));
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
