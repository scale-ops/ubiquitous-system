import { downloadPdfBase64, getCandidate, getJob, isPool } from "@/lib/airtable";
import { deepReview } from "@/lib/claude";
import { handle } from "@/lib/http";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(async () => {
    const { jobId, jobSummary, pool, candidateId } = (await request.json()) as {
      jobId: string;
      jobSummary: string;
      pool: string;
      candidateId: string;
    };
    if (!isPool(pool)) throw new Error("Unknown candidate pool");
    const [job, candidate] = await Promise.all([getJob(jobId), getCandidate(pool, candidateId)]);
    const [jobPdf, resumePdf] = await Promise.all([
      job.fileUrl ? downloadPdfBase64(job.fileUrl) : null,
      candidate.resumeUrl ? downloadPdfBase64(candidate.resumeUrl) : null,
    ]);
    const review = await deepReview({ jobName: job.name, jobPdf, jobSummary, candidate, resumePdf });
    return { review };
  });
}
