import type { Metadata } from "next";
import BookingClient from "./client";

export const metadata: Metadata = {
  title: "Book your interview",
  robots: { index: false, follow: false },
};

export default async function BookPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <BookingClient code={code} />;
}
