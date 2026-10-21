import type { MediaGenCandidate } from "@/app/api/mediagen/route";

// Headcount needed per domain for the PKJA RLI MediaGen request.
export const DOMAINS: Record<string, number> = {
  "Architecture & Interior Design": 12,
  "Graphic Design": 9,
  "Video Production": 24,
  "3D Modeling & CAD": 24,
  "Animation & Motion": 24,
  "Game Development": 22,
};
export const STATUSES = ["Shortlist", "Backup", "Reactivation needed", "Not eligible", "All"] as const;
export const VERDICTS = ["All", "Strong fit", "Good fit", "Possible fit", "Weak fit", "Not eligible"] as const;
export const STATUS_ORDER = ["Shortlist", "Backup", "Reactivation needed", "Not eligible"];

export function badgeClass(verdict: string) {
  if (verdict === "Strong fit" || verdict === "Good fit") return "badge good";
  if (verdict === "Possible fit") return "badge ok";
  return "badge low";
}

// One-line "why", like the BDR/WPC results: the main strength, plus the main concern if there is one.
export function summary(c: MediaGenCandidate) {
  if (c.status === "Not eligible") {
    const reason = c.concerns.find((g) => g.startsWith("Blocked") || g.startsWith("Resume could not be matched"));
    if (reason) return `Not eligible: ${reason}`;
  }
  const strength = c.why.find((w) => !w.startsWith("Background:")) ?? c.why[0] ?? "";
  const concern = c.concerns.find((g) => g !== "None significant");
  return concern ? `${strength}. Watch: ${concern}` : strength;
}

export function downloadCsv(rows: MediaGenCandidate[], fileName: string) {
  const header = ["Domain", "Rank", "Status", "Name", "Email", "Verdict", "Score", "Why they're a fit", "Concerns / gaps", "Background", "Availability",
    "Quality tier", "Quality score", "Quality score 90d", "Defect rate", "Quality flags"];
  const lines = rows.map((r) => [
    r.domain, r.rank ?? "", r.status, r.name, r.email, r.verdict, r.score ?? "",
    r.why.join("; "), r.concerns.join("; "), r.profile, r.availability,
    r.qualitySignals.tier, r.qualitySignals.score ?? "", r.qualitySignals.score90d ?? "", r.qualitySignals.defectRate ?? "",
    r.qualitySignals.flags.join("; "),
  ]);
  const csv = [header, ...lines]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = fileName;
  link.click();
}
