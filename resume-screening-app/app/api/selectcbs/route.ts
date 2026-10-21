import { handle } from "@/lib/http";

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
};

type AirtableRecord = { id: string; fields: Record<string, unknown> };

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && "name" in value) return String(value.name);
  return String(value);
}

const num = (value: unknown) => (typeof value === "number" ? value : null);

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
