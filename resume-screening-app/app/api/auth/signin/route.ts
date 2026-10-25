import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl } from "@/lib/google-auth";
import { OAUTH_COOKIE, cookieOptions, randomToken, seal } from "@/lib/session";

// Starts Google sign-in: remembers a one-time state + nonce in a short-lived cookie, then sends
// the browser to Google.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const requested = request.nextUrl.searchParams.get("returnTo") ?? "/";
  // Only same-site paths, so the sign-in can't be used to bounce people to another website.
  const returnTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  const state = randomToken();
  const nonce = randomToken();
  const response = NextResponse.redirect(authorizeUrl(origin, state, nonce));
  response.cookies.set(OAUTH_COOKIE, await seal({ state, nonce, returnTo, exp: Date.now() + 10 * 60_000 }), cookieOptions(600));
  return response;
}
