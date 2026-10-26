import type { NextRequest } from "next/server";
import { getRamp, listActiveWorkforceManagers, updateRamp } from "@/lib/airtable";
import { handle } from "@/lib/http";
import { validateRamp } from "@/lib/ramps";

type Params = { params: Promise<{ id: string }> };

function checkId(id: string): string {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) throw new Error("That ramp link isn't valid.");
  return id;
}

export async function GET(_request: NextRequest, { params }: Params) {
  return handle(async () => ({ ramp: await getRamp(checkId((await params).id)) }));
}

// Change any of the ramp's settings (name, interviewers, status, dates, hours…).
export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const id = checkId((await params).id);
    const body = (await request.json()) as Record<string, unknown>;
    const managers = await listActiveWorkforceManagers();
    const changes = validateRamp(body, new Set(managers.map((m) => m.id)), true);
    return { ramp: await updateRamp(id, changes) };
  });
}
