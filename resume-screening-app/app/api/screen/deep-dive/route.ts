import type { NextRequest } from "next/server";
import { handle } from "@/lib/http";
import { deepDiveForRamp, loadRamp } from "@/lib/screening";
import { SESSION_COOKIE, currentUser } from "@/lib/session";

export const maxDuration = 300;

// Deep dive on one candidate for a ramp (full résumé + job description), saved to Airtable.
export async function POST(request: NextRequest) {
  return handle(async () => {
    const user = await currentUser(request.cookies.get(SESSION_COOKIE)?.value);
    const body = (await request.json()) as { rampId: string; jobSummary: string; candidateId: string };
    const ramp = await loadRamp(body.rampId);
    return deepDiveForRamp(ramp, String(body.jobSummary ?? ""), String(body.candidateId ?? ""), user?.email ?? "");
  });
}
