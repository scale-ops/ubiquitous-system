import type { NextRequest } from "next/server";
import { getRamp } from "@/lib/airtable";
import { handle } from "@/lib/http";
import { rampAvailability } from "@/lib/ramps";

// Open interview spots for a ramp, read live from its interviewers' calendars. Read-only.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) throw new Error("That ramp link isn't valid.");
    return await rampAvailability(await getRamp(id));
  });
}
