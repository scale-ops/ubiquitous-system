import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(`${request.nextUrl.origin}/signin?signedOut=1`);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
