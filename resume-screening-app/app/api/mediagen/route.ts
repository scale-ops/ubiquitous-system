import { handle } from "@/lib/http";
import { toQuality, type Quality } from "@/lib/quality";

// Lists the pre-ranked MediaGen QMA candidates from Airtable (read-only).
// Rankings, verdicts and the "why" text were written into the table ahead of time; nothing is re-scored here.

const TABLE = "MediaGen QMA";

export type MediaGenCandidate = {
  id: string;
  name: string;
  email: string;
  country: string;
  domain: string;
  status: string;
  rank: number | null;
  score: number | null;
  verdict: string;
  priority: string;
  why: string[];
  concerns: string[];
  profile: string;
  notes: string;
  yearsInField: number | null;
  degree: string;
  certifications: string;
  quality: string;
  availability: string;
  lastPaidWork: string;
  rosterTier: string;
  team: string;
  alsoQualifiedIn: string;
  mediagenCheck: string;
  selectCb: boolean;
  qualitySignals: Quality;
};

type AirtableRecord = { id: string; fields: Record<string, unknown> };

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && "name" in value) return String(value.name);
  return String(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

// "• one\n• two" -> ["one", "two"]
function bullets(value: unknown): string[] {
  return text(value).split("\n").map((line) => line.replace(/^\s*•\s*/, "").trim()).filter(Boolean);
}

function toCandidate(record: AirtableRecord): MediaGenCandidate {
  const f = record.fields;
  return {
    id: record.id,
    name: text(f["Name"]) || record.id,
    email: text(f["Email"]),
    country: text(f["Country"]),
    domain: text(f["Domain"]),
    status: text(f["Status"]),
    rank: num(f["Domain Rank"]),
    score: num(f["AI Trainer Fit Score"]),
    verdict: text(f["Fit Verdict"]),
    priority: text(f["Priority"]),
    why: bullets(f["Why They're a Fit"]),
    concerns: bullets(f["Concerns / Gaps"]),
    profile: text(f["Resume Profile"]),
    notes: text(f["Resume Notes"]),
    yearsInField: num(f["Years in Field"]),
    degree: text(f["Highest Degree"]),
    certifications: text(f["Certifications"]),
    quality: text(f["Quality Level"]),
    availability: text(f["Availability"]),
    lastPaidWork: text(f["Last Paid Work"]),
    rosterTier: text(f["Roster Tier"]),
    team: text(f["Source / Team"]),
    alsoQualifiedIn: text(f["Also Qualified In"]),
    mediagenCheck: text(f["MediaGen Check"]),
    selectCb: f["In Select CBs List"] === true,
    qualitySignals: toQuality(f),
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
    const res = await fetch(`https://api.airtable.com/v0/${base}/${encodeURIComponent(TABLE)}?${params}`, {
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
  return handle(async () => ({ candidates: (await listAll()).map(toCandidate) }));
}
