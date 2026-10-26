import type { NextRequest } from "next/server";
import { handle } from "@/lib/http";
import { loadRamp, sendPreInterviews } from "@/lib/screening";
import { SESSION_COOKIE, currentUser } from "@/lib/session";

export const maxDuration = 300;

// dryRun: true returns a preview of the email and any problems; false sends it.
export async function POST(request: NextRequest) {
  return handle(async () => {
    const user = await currentUser(request.cookies.get(SESSION_COOKIE)?.value);
    const body = (await request.json()) as { rampId: string; candidateIds: string[]; dryRun: boolean };
    if (!Array.isArray(body.candidateIds) || !body.candidateIds.length || body.candidateIds.length > 50) {
      throw new Error("Pick between 1 and 50 candidates.");
    }
    const ramp = await loadRamp(body.rampId);
    return sendPreInterviews(ramp, body.candidateIds.map(String), body.dryRun !== false, user?.email ?? "");
  });
}
