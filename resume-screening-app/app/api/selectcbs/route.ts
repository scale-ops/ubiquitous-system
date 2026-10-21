import { handle } from "@/lib/http";
import { toQuality, type Quality } from "@/lib/quality";

// Lists every Select CB with their MediaGen evaluation from the Select CBs table in Airtable (read-only).
const TABLE = "tblbT2o0Il8cjaKaJ";

export type SelectCb = {
  id: string;
  name: string;
  email: string;
  status: string;
  verdict: string;
  domain: string;
  rank: number | null;
  score: number | null;
  why: string[];
  concerns: string[];
  profile: string;
  mainField: string;
  tier: string;
  team: string;
  performance: number | null;
  hoursPerWeek: number | null;
  hasResume: boolean;
  quality: Quality;
  resume: ResumeDetail;
};

// Parsed-resume deep dive (from the platform's resume parser, loaded into the table).
export type ResumeDetail = {
  parsed: boolean;
  highestDegree: string;
  fieldsOfStudy: string;
  education: string[];
  topTierSchool: boolean;
  seniority: string;
  latestRole: string;
  currentlyEmployed: boolean;
  jobsListed: number | null;
  careerSpan: number | null;
  topField: string;
  experienceByField: string;
  reviewLeadExp: boolean;
  workHistory: string[];
  skills: string[];
  certifications: string[];
  publications: string[];
  tests: string;
  parsedOn: string;
};

type AirtableRecord = { id: string; fields: Record<string, unknown> };

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && "name" in value) return String(value.name);
  return String(value);
}

const num = (value: unknown) => (typeof value === "number" ? value : null);

const lines = (value: unknown) => text(value).split("\n").map((l) => l.trim()).filter(Boolean);
const list = (value: unknown, sep: string) => text(value).split(sep).map((l) => l.trim()).filter(Boolean);

function toResume(f: Record<string, unknown>): ResumeDetail {
  const degree = text(f["Highest Degree"]);
  return {
    parsed: Boolean(degree) && degree !== "No parsed resume",
    highestDegree: degree,
    fieldsOfStudy: text(f["Fields of Study"]),
    education: lines(f["Education Detail"]),
    topTierSchool: f["Top-Tier School"] === true,
    seniority: text(f["Seniority"]),
    latestRole: text(f["Latest Role"]),
    currentlyEmployed: f["Currently Employed"] === true,
    jobsListed: num(f["Jobs Listed"]),
    careerSpan: num(f["Career Span (yrs)"]),
    topField: text(f["Top Experience Field"]),
    experienceByField: text(f["Experience by Field"]),
    reviewLeadExp: f["Review / Teaching / Lead Exp"] === true,
    workHistory: lines(f["Work History"]),
    skills: list(f["Resume Skills"], ","),
    certifications: list(f["Certifications"], ";"),
    publications: list(f["Publications"], ";"),
    tests: text(f["Standardized Tests"]),
    parsedOn: text(f["Resume Parsed On"]),
  };
}

// "• one\n• two" -> ["one", "two"]
const bullets = (value: unknown) =>
  text(value).split("\n").map((line) => line.replace(/^\s*•\s*/, "").trim()).filter(Boolean);

function toSelectCb(record: AirtableRecord): SelectCb {
  const f = record.fields;
  const resume = f["Resume from Outlier Attachment"];
  return {
    id: record.id,
    name: text(f["NAME"]) || text(f["EMAIL"]) || record.id,
    email: text(f["EMAIL"]),
    status: text(f["Status"]),
    verdict: text(f["Fit Verdict"]),
    domain: text(f["Domain"]),
    rank: num(f["Domain Rank"]),
    score: num(f["AI Trainer Fit Score"]),
    why: bullets(f["Why They're a Fit"]),
    concerns: bullets(f["Concerns / Gaps"]),
    profile: text(f["Resume Profile"]),
    mainField: text(f["Main Field"]),
    tier: text(f["TIER_LEVEL"]),
    team: text(f["TEAM_FROZEN"]),
    performance: num(f["PERFORMANCE_SCORE"]),
    hoursPerWeek: num(f["AVG_PAID_HRS_WEEK_4W"]),
    hasResume: Array.isArray(resume) && resume.length > 0,
    quality: toQuality(f),
    resume: toResume(f),
  };
}

async function listAll(): Promise<AirtableRecord[]> {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) throw new Error("Missing environment variable AIRTABLE_TOKEN or AIRTABLE_BASE_ID");
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const res = await fetch(`https://api.airtable.com/v0/${base}/${TABLE}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

export async function GET() {
  return handle(async () => ({ people: (await listAll()).map(toSelectCb) }));
}
