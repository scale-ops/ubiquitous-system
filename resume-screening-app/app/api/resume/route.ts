import { NextResponse } from "next/server";
import { getCandidate, isPool } from "@/lib/airtable";

// Airtable file links expire after a few hours, so look up a fresh link each time.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pool = params.get("pool");
  const id = params.get("id");
  if (!isPool(pool) || !id) return new NextResponse("Bad request", { status: 400 });
  const candidate = await getCandidate(pool, id);
  if (!candidate.resumeUrl) return new NextResponse("No resume on file", { status: 404 });
  return NextResponse.redirect(candidate.resumeUrl);
}
