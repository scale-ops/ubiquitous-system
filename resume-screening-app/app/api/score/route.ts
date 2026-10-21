import { downloadPdfBase64, hasProfileText, isAirtableFile, type Candidate } from "@/lib/airtable";
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
    // Candidates without profile text (Select CBs) are scored from their resume PDF.
    // The links come from the browser, so only fetch files hosted by Airtable.
    const needResume = candidates.filter((c) => !hasProfileText(c) && c.resumeUrl && isAirtableFile(c.resumeUrl));
    const pdfs = await Promise.all(needResume.map((c) => downloadPdfBase64(c.resumeUrl!).catch(() => null)));
    const resumes = Object.fromEntries(needResume.map((c, i) => [c.id, pdfs[i]]));
    return { scores: await scoreCandidates(jobSummary, candidates, resumes) };
  });
}
