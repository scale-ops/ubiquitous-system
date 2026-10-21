// Platform quality signals, read from the quality fields that exist on both the Select CBs and MediaGen QMA tables.
// The values (and the Quality Tier / Trend / Flags formulas) are computed in Airtable; this only reads them.

export type Quality = {
  tier: string;
  trend: string;
  flags: string[];
  score: number | null;
  score90d: number | null;
  scoredTasks: number | null;
  scoredTasks90d: number | null;
  defectRate: number | null;
  qcScore: number | null;
  qcAudits: number | null;
  rejectionRate: number | null;
  pctGoodQc: number | null;
  pctGoodQms: number | null;
  pctGoodSbq: number | null;
  disables: number | null;
  disables90d: number | null;
  lastDisable: string;
  onboardingPassRate: string;
  projects: number | null;
  maxReviewLevel: number | null;
  reviewsGiven: number | null;
  lastTask: string;
  tnsFlag: boolean;
};

// Quality Tier formula values, best first.
export const QUALITY_TIERS = ["🟢 Strong", "🟡 Good", "🟠 Watch", "🔴 At risk", "⚪ Not measured"] as const;

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && "name" in value) return String(value.name);
  return String(value);
}

const num = (value: unknown) => (typeof value === "number" ? value : null);

export function toQuality(f: Record<string, unknown>): Quality {
  return {
    tier: text(f["Quality Tier"]) || "⚪ Not measured",
    trend: text(f["Quality Trend"]),
    flags: text(f["Quality Flags"]).split(";").map((s) => s.trim()).filter(Boolean),
    score: num(f["Quality Score (1-5)"]),
    score90d: num(f["Quality Score 90d (1-5)"]),
    scoredTasks: num(f["Scored Tasks"]),
    scoredTasks90d: num(f["Scored Tasks 90d"]),
    defectRate: num(f["Defect Rate"]),
    qcScore: num(f["QC Score (1-5)"]),
    qcAudits: num(f["QC Audits"]),
    rejectionRate: num(f["Rejection Rate"]),
    pctGoodQc: num(f["% Good QC"]),
    pctGoodQms: num(f["% Good QMS"]),
    pctGoodSbq: num(f["% Good SBQ"]),
    disables: num(f["Quality Disables"]),
    disables90d: num(f["Quality Disables 90d"]),
    lastDisable: text(f["Last Quality Disable"]),
    onboardingPassRate: text(f["Onboarding Pass Rate"]),
    projects: num(f["Projects Worked"]),
    maxReviewLevel: num(f["Max Review Level"]),
    reviewsGiven: num(f["Reviews Given"]),
    lastTask: text(f["Last Task Date"]),
    tnsFlag: f["T&S / Fraud Flag"] === true,
  };
}

// Sort key: tier order, then score (higher first).
export function tierRank(q: Quality): number {
  const i = (QUALITY_TIERS as readonly string[]).indexOf(q.tier);
  return i === -1 ? QUALITY_TIERS.length : i;
}

export const pct = (value: number | null) => (value == null ? "–" : `${Math.round(value * 1000) / 10}%`);
