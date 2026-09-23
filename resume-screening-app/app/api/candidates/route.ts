import { isPool, listCandidates } from "@/lib/airtable";
import { handle } from "@/lib/http";

export async function GET(request: Request) {
  return handle(async () => {
    const pool = new URL(request.url).searchParams.get("pool");
    if (!isPool(pool)) throw new Error("Unknown candidate pool");
    return { candidates: await listCandidates(pool) };
  });
}
