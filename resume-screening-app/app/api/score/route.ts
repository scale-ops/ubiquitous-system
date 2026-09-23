import type { Candidate } from "@/lib/airtable";
import { scoreCandidates } from "@/lib/claude";
import { handle } from "@/lib/http";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(async () => {
    const { jobSummary, candidates } = (await request.json()) as {
      jobSummary: string;
      candidates: Candidate[];
    };
    if (!jobSummary || !Array.isArray(candidates) || candidates.length > 50) {
      throw new Error("Send a job summary and up to 50 candidates");
    }
    return { scores: await scoreCandidates(jobSummary, candidates) };
  });
}
