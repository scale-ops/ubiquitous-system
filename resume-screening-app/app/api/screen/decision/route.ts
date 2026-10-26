import type { NextRequest } from "next/server";
import { handle } from "@/lib/http";
import { decide, loadRamp } from "@/lib/screening";
import { SESSION_COOKIE, currentUser } from "@/lib/session";

// "invite" sends the interview booking link; "not_selected" only marks the candidate.
export async function POST(request: NextRequest) {
  return handle(async () => {
    const user = await currentUser(request.cookies.get(SESSION_COOKIE)?.value);
    const body = (await request.json()) as { rampId: string; interviewId: string; decision: string };
    if (body.decision !== "invite" && body.decision !== "not_selected") throw new Error("Unknown decision.");
    if (!/^rec[A-Za-z0-9]{14}$/.test(String(body.interviewId))) throw new Error("Unknown candidate.");
    const ramp = await loadRamp(body.rampId);
    return decide(ramp, body.interviewId, body.decision, user?.email ?? "", request.nextUrl.origin);
  });
}
