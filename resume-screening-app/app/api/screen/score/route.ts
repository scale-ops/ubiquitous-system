import type { NextRequest } from "next/server";
import { handle } from "@/lib/http";
import { loadRamp, scoreForRamp } from "@/lib/screening";
import { SESSION_COOKIE, currentUser } from "@/lib/session";

export const maxDuration = 300;

// Scores up to 20 candidates for a ramp and saves the results to Airtable.
export async function POST(request: NextRequest) {
  return handle(async () => {
    const user = await currentUser(request.cookies.get(SESSION_COOKIE)?.value);
    const body = (await request.json()) as { rampId: string; jobSummary: string; candidateIds: string[] };
    if (!Array.isArray(body.candidateIds) || body.candidateIds.length > 20) throw new Error("Send up to 20 candidates at a time.");
    const ramp = await loadRamp(body.rampId);
    return scoreForRamp(ramp, String(body.jobSummary ?? ""), body.candidateIds.map(String), user?.email ?? "");
  });
}
