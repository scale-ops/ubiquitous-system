import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Screening",
  description: "Rank candidates from Airtable against job descriptions with Claude",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
