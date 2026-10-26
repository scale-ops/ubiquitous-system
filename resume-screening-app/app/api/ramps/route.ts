import type { NextRequest } from "next/server";
import { createRamp, listActiveWorkforceManagers, listJobs, listRamps, type RampInput } from "@/lib/airtable";
import { handle } from "@/lib/http";
import { validateRamp } from "@/lib/ramps";
import { SESSION_COOKIE, currentUser } from "@/lib/session";

// Ramps list, plus what the "New ramp" form needs: active Workforce Managers and jobs.
export async function GET() {
  return handle(async () => {
    const [ramps, managers, jobs] = await Promise.all([listRamps(), listActiveWorkforceManagers(), listJobs()]);
    return {
      ramps,
      managers: managers.map(({ id, name, email }) => ({ id, name, email })),
      jobs: jobs.map(({ id, name }) => ({ id, name })),
    };
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const user = await currentUser(request.cookies.get(SESSION_COOKIE)?.value);
    const body = (await request.json()) as Record<string, unknown>;
    const managers = await listActiveWorkforceManagers();
    const input = validateRamp(body, new Set(managers.map((m) => m.id))) as RampInput;
    return { ramp: await createRamp(input, user?.email ?? "") };
  });
}
