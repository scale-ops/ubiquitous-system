import { NextResponse, type NextRequest } from "next/server";

// Password-protects the whole app (candidate data is private).
// The browser shows a login box: any username, password = APP_PASSWORD.
export function proxy(request: NextRequest) {
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
