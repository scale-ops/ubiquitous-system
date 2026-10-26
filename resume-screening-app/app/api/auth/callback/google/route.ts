import { NextResponse, type NextRequest } from "next/server";
import { findActiveTeamMember } from "@/lib/airtable";
import { exchangeCode } from "@/lib/google-auth";
import { OAUTH_COOKIE, SESSION_COOKIE, SESSION_HOURS, cookieOptions, seal, unseal, type OAuthState } from "@/lib/session";

// Google sends the browser back here. We check the one-time state, get the person's verified email
// from Google, and let them in only if they're an Active Internal Team member.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const params = request.nextUrl.searchParams;
  const fail = (reason: string) => {
    const response = NextResponse.redirect(`${origin}/signin?error=${reason}`);
    response.cookies.delete(OAUTH_COOKIE);
    return response;
  };

  const saved = await unseal<OAuthState>(request.cookies.get(OAUTH_COOKIE)?.value);
  const code = params.get("code");
  if (params.get("error")) return fail("cancelled");
  if (!saved || !code || params.get("state") !== saved.state) return fail("expired");

  try {
    const identity = await exchangeCode(origin, code, saved.nonce);
    const member = await findActiveTeamMember(identity.email);
    if (!member) {
      console.warn(`Sign-in refused: ${identity.email} is not an Active Internal Team member`);
      return fail("not_allowed");
    }
    const response = NextResponse.redirect(`${origin}${saved.returnTo}`);
    response.cookies.delete(OAUTH_COOKIE);
    const session = { email: member.email, name: member.name || identity.name, exp: Date.now() + SESSION_HOURS * 3_600_000 };
    response.cookies.set(SESSION_COOKIE, await seal(session), cookieOptions(SESSION_HOURS * 3600));
    return response;
  } catch (error) {
    console.error(error);
    return fail("failed");
  }
}
