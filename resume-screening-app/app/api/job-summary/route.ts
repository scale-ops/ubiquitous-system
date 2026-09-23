import { downloadPdfBase64, getJob } from "@/lib/airtable";
import { summarizeJob } from "@/lib/claude";
import { handle } from "@/lib/http";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(async () => {
    const { jobId } = (await request.json()) as { jobId: string };
    const job = await getJob(jobId);
    if (!job.fileUrl) throw new Error(`"${job.name}" has no job description PDF attached in Airtable`);
    const pdf = await downloadPdfBase64(job.fileUrl);
    if (!pdf) throw new Error(`Could not read the PDF for "${job.name}"`);
    return { summary: await summarizeJob(job.name, pdf) };
  });
}
