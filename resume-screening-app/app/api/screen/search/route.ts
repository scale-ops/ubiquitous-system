import { listResults, searchPool } from "@/lib/airtable";
import { handle } from "@/lib/http";
import { loadRamp } from "@/lib/screening";

// Candidates matching the filters (up to 300), with any score they already have for this ramp.
export async function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as {
      rampId: string;
      countries?: string[];
      activeDays?: number | null;
      hasResume?: boolean;
      minQms?: number | null;
      minQc?: number | null;
      limit?: number;
    };
    const ramp = await loadRamp(body.rampId);
    const limit = Math.min(Math.max(Number(body.limit) || 300, 1), 300);
    const [{ candidates, more }, results] = await Promise.all([
      searchPool(
        {
          countries: Array.isArray(body.countries) ? body.countries.map(String) : [],
          activeDays: body.activeDays ? Number(body.activeDays) : null,
          hasResume: Boolean(body.hasResume),
          minQms: body.minQms == null || body.minQms === ("" as unknown) ? null : Number(body.minQms),
          minQc: body.minQc == null || body.minQc === ("" as unknown) ? null : Number(body.minQc),
        },
        limit,
      ),
      listResults(ramp),
    ]);
    const byWorker = new Map(results.map((r) => [r.workerId, r]));
    return {
      more,
      candidates: candidates.map((c) => ({
        id: c.id,
        workerId: c.workerId,
        name: c.name,
        email: c.email,
        country: c.country,
        team: c.team,
        jobTitle: c.jobTitle.slice(0, 300),
        lastActive: c.lastActive,
        qms: c.qms,
        qc: c.qc,
        hasResume: c.hasResume,
        result: byWorker.get(c.workerId) ?? null,
      })),
    };
  });
}
