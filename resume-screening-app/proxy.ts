import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, googleSignInEnabled, unseal, type Session } from "@/lib/session";

// Protects every page and API route (candidate data is private).
// With Google settings present, people sign in with Google and must be Active in the Internal Team table.
// Without them (for example a local copy), the old shared password still works:
// the browser shows a login box, any username, password = APP_PASSWORD.

// Pages that must open without signing in: the sign-in itself, and candidates' private booking
// links (the secret code in the link is their key).
const PUBLIC_PATHS = ["/signin", "/api/auth/"];
const CANDIDATE_PATHS = ["/book/", "/api/book/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (CANDIDATE_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (googleSignInEnabled()) {
    if (isPublic(pathname)) return NextResponse.next();
    const session = await unseal<Session>(request.cookies.get(SESSION_COOKIE)?.value);
    if (session) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Your sign-in has expired. Reload the page to sign in again." }, { status: 401 });
    }
    const signin = new URL("/signin", request.url);
    signin.searchParams.set("returnTo", `${pathname}${search}`);
    return NextResponse.redirect(signin);
  }

  const password = process.env.APP_PASSWORD;
  if (!password) {
    return new NextResponse("Set the APP_PASSWORD environment variable to use this app.", { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (supplied === password) return NextResponse.next();
  }
  return new NextResponse("Login required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Resume Screening"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
