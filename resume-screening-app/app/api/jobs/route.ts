import { listJobs } from "@/lib/airtable";
import { handle } from "@/lib/http";

export async function GET() {
  return handle(async () => ({ jobs: await listJobs() }));
}
