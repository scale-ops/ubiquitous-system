import { NextResponse, type NextRequest } from "next/server";
import { BookingError, bookTime, bookingView } from "@/lib/booking";

// Public (no sign-in): a candidate's private booking link. The code in the URL is the only key.
type Params = { params: Promise<{ code: string }> };

function validCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{40,60}$/.test(code);
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { code } = await params;
  if (!validCode(code)) return NextResponse.json({ state: "invalid" });
  try {
    return NextResponse.json(await bookingView(code));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "We couldn't load interview times right now. Please try again in a few minutes." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { code } = await params;
  if (!validCode(code)) return NextResponse.json({ error: "This booking link isn't valid." }, { status: 400 });
  try {
    const body = (await request.json()) as { start?: unknown; timeZone?: unknown };
    if (typeof body.start !== "string" || Number.isNaN(Date.parse(body.start))) {
      return NextResponse.json({ error: "Please pick a time." }, { status: 400 });
    }
    return NextResponse.json(await bookTime(code, body.start, String(body.timeZone ?? "UTC")));
  } catch (error) {
    if (error instanceof BookingError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong booking your interview. Please try again." }, { status: 500 });
  }
}
