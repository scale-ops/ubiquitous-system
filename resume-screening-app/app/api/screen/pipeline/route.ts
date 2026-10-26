import { handle } from "@/lib/http";
import { loadRamp, pipeline } from "@/lib/screening";

export const maxDuration = 120;

// Everyone in this ramp's pipeline, with pre-interview answers and eligibility checks.
export async function GET(request: Request) {
  return handle(async () => {
    const rampId = new URL(request.url).searchParams.get("rampId") ?? "";
    return pipeline(await loadRamp(rampId));
  });
}
