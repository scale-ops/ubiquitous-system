import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE, googleSignInEnabled, unseal, type Session } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Screening",
  description: "Rank candidates from Airtable against job descriptions with Claude",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read cookies on every request (not at build time), so the bar always shows who is signed in.
  const store = await cookies();
  const session = googleSignInEnabled() ? await unseal<Session>(store.get(SESSION_COOKIE)?.value) : null;
  return (
    <html lang="en">
      <body>
        {session && (
          <div className="userbar">
            <span>{session.name || session.email}</span>
            <a href="/api/auth/signout">Sign out</a>
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
